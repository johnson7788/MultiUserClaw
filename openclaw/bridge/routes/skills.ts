import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import archiver from "archiver";
import unzipper from "unzipper";
import type { BridgeConfig } from "../config.js";
import type { BridgeGatewayClient } from "../gateway-client.js";
import { asyncHandler } from "../utils.js";

interface SkillInfo {
  name: string;
  description: string;
  source: string;
  available: boolean;
  disabled: boolean;
  path: string;
}

function parseSkillMd(content: string): { description: string } {
  // Extract description from SKILL.md frontmatter or first line
  const lines = content.split("\n");
  let inFrontmatter = false;
  let description = "";

  for (const line of lines) {
    if (line.trim() === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) {
      const match = line.match(/^description:\s*(.+)/);
      if (match) {
        description = match[1].trim();
      }
    }
  }

  if (!description && lines.length > 0) {
    // Use first non-empty, non-frontmatter line as description
    description = lines.find((l) => l.trim() && l.trim() !== "---") || "";
  }

  return { description };
}

function scanSkillsDir(dir: string, source: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  if (!fs.existsSync(dir)) return skills;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Follow symlinks: isDirectory() returns false for symlinks
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const entryPath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(entryPath);
      if (!stat.isDirectory()) continue;
    } catch { continue; }
    const skillMdPath = path.join(entryPath, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    const content = fs.readFileSync(skillMdPath, "utf-8");
    const { description } = parseSkillMd(content);

    skills.push({
      name: entry.name,
      description,
      source,
      available: true,
      disabled: false,
      path: skillMdPath,
    });
  }

  return skills;
}

export function skillsRoutes(config: BridgeConfig, client: BridgeGatewayClient): Router {
  const router = Router();
  const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

  const builtinSkillsDir = path.resolve(process.cwd(), "skills");
  const globalSkillsDir = path.join(config.openclawHome, "skills");
  const workspaceSkillsDir = path.join(config.workspacePath, "skills");

  // GET /api/skills
  router.get("/skills", asyncHandler(async (_req, res) => {
    const builtin = scanSkillsDir(builtinSkillsDir, "builtin");
    const global = scanSkillsDir(globalSkillsDir, "global");
    const workspace = scanSkillsDir(workspaceSkillsDir, "workspace");

    // Priority: workspace > global > builtin (higher overrides lower)
    const skillMap = new Map<string, SkillInfo>();
    for (const s of builtin) skillMap.set(s.name, s);
    for (const s of global) skillMap.set(s.name, s);
    for (const s of workspace) skillMap.set(s.name, s);

    // Merge disabled state from gateway skills.status
    try {
      const statusReport = await client.request<{ skills?: Array<{ name?: string; skillKey?: string; disabled?: boolean }> }>("skills.status", {});
      const statusSkills = statusReport?.skills || [];
      for (const ss of statusSkills) {
        const key = ss.name || ss.skillKey || "";
        const existing = skillMap.get(key);
        if (existing && ss.disabled) {
          existing.disabled = true;
        }
      }
    } catch {
      // Gateway may not support skills.status — just return without disabled info
    }

    res.json(Array.from(skillMap.values()));
  }));

  // PUT /api/skills/:name/toggle — enable or disable a skill
  router.put("/skills/:name/toggle", asyncHandler(async (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    try {
      await client.request("skills.update", {
        skillKey: req.params.name,
        enabled,
      });
      res.json({ ok: true, name: req.params.name, enabled });
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  }));

  // DELETE /api/skills/:name
  router.delete("/skills/:name", asyncHandler(async (req, res) => {
    const name = req.params.name;
    const skillDir = path.join(workspaceSkillsDir, name);

    if (!fs.existsSync(skillDir)) {
      // Check if it's a builtin skill
      const builtinDir = path.join(builtinSkillsDir, name);
      if (fs.existsSync(builtinDir)) {
        res.status(400).json({ detail: "Cannot delete builtin skills" });
        return;
      }
      res.status(404).json({ detail: "Skill not found" });
      return;
    }

    fs.rmSync(skillDir, { recursive: true });
    res.json({ ok: true });
  }));

  // GET /api/skills/:name/download
  router.get("/skills/:name/download", asyncHandler(async (req, res) => {
    const name = req.params.name;

    // Check workspace first, then builtin
    let skillDir = path.join(workspaceSkillsDir, name);
    if (!fs.existsSync(skillDir)) {
      skillDir = path.join(builtinSkillsDir, name);
    }
    if (!fs.existsSync(skillDir)) {
      res.status(404).json({ detail: "Skill not found" });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    archive.directory(skillDir, name);
    await archive.finalize();
  }));

  // POST /api/skills/upload
  router.post("/skills/upload", upload.single("file"), asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ detail: "No file provided" });
      return;
    }

    if (!file.originalname.endsWith(".zip")) {
      res.status(400).json({ detail: "File must be a .zip archive" });
      return;
    }

    // Extract zip to a temp dir, find SKILL.md
    const tmpDir = path.join(config.openclawHome, "tmp", `skill-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const directory = await unzipper.Open.buffer(file.buffer);
      await directory.extract({ path: tmpDir });

      // Find SKILL.md
      let skillMdPath: string | null = null;
      let skillName: string | null = null;

      // Check root level
      if (fs.existsSync(path.join(tmpDir, "SKILL.md"))) {
        skillMdPath = path.join(tmpDir, "SKILL.md");
        skillName = path.basename(file.originalname, ".zip");
      } else {
        // Check one level deep
        for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const mdPath = path.join(tmpDir, entry.name, "SKILL.md");
            if (fs.existsSync(mdPath)) {
              skillMdPath = mdPath;
              skillName = entry.name;
              break;
            }
          }
        }
      }

      if (!skillMdPath || !skillName) {
        res.status(400).json({ detail: "Zip must contain a SKILL.md file" });
        return;
      }

      // Move to workspace skills dir
      const destDir = path.join(workspaceSkillsDir, skillName);
      fs.mkdirSync(workspaceSkillsDir, { recursive: true });
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true });
      }

      const sourceDir = path.dirname(skillMdPath) === tmpDir
        ? tmpDir
        : path.dirname(skillMdPath);
      fs.cpSync(sourceDir, destDir, { recursive: true });

      const content = fs.readFileSync(path.join(destDir, "SKILL.md"), "utf-8");
      const { description } = parseSkillMd(content);

      res.json({
        name: skillName,
        description,
        source: "workspace",
        available: true,
        path: path.join(destDir, "SKILL.md"),
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }));

  return router;
}
