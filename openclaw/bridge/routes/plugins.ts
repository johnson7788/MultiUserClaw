import { Router } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { BridgeConfig } from "../config.js";
import { asyncHandler } from "../utils.js";

interface PluginInfo {
  name: string;
  description: string;
  source: string;
  version?: string;
  installedAt?: string;
  enabled?: boolean;
  agents: Array<{ name: string; description: string; model: string | null }>;
  commands: Array<{ name: string; description: string; argument_hint: string | null }>;
  skills: string[];
}

function scanPlugin(pluginDir: string, pluginName: string, source: string): PluginInfo | null {
  // Try plugin.json or .claude-plugin/plugin.json
  let pluginJsonPath = path.join(pluginDir, "plugin.json");
  if (!fs.existsSync(pluginJsonPath)) {
    pluginJsonPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  }

  let description = "";
  if (fs.existsSync(pluginJsonPath)) {
    try {
      const pj = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
      description = pj.description || "";
    } catch { /* ignore */ }
  }

  // Scan agents
  const agents: PluginInfo["agents"] = [];
  const agentsDir = path.join(pluginDir, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
      let name = path.basename(file, ".md");
      let desc = "";
      let model: string | null = null;
      let inFm = false;

      for (const line of content.split("\n")) {
        if (line.trim() === "---") { inFm = !inFm; continue; }
        if (inFm) {
          const nm = line.match(/^name:\s*(.+)/);
          if (nm) name = nm[1].trim();
          const dm = line.match(/^description:\s*(.+)/);
          if (dm) desc = dm[1].trim();
          const mm = line.match(/^model:\s*(.+)/);
          if (mm) model = mm[1].trim();
        }
      }

      agents.push({ name, description: desc, model });
    }
  }

  // Scan commands
  const commands: PluginInfo["commands"] = [];
  const cmdDir = path.join(pluginDir, "commands");
  if (fs.existsSync(cmdDir)) {
    for (const file of fs.readdirSync(cmdDir)) {
      if (!file.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(cmdDir, file), "utf-8");
      let desc = "";
      let hint: string | null = null;
      let inFm = false;

      for (const line of content.split("\n")) {
        if (line.trim() === "---") { inFm = !inFm; continue; }
        if (inFm) {
          const dm = line.match(/^description:\s*(.+)/);
          if (dm) desc = dm[1].trim();
          const hm = line.match(/^argument-hint:\s*(.+)/);
          if (hm) hint = hm[1].trim();
        }
      }

      commands.push({
        name: path.basename(file, ".md"),
        description: desc,
        argument_hint: hint,
      });
    }
  }

  // Scan skills
  const skills: string[] = [];
  const skillsDir = path.join(pluginDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md"))) {
        skills.push(entry.name);
      }
    }
  }

  return { name: pluginName, description, source, agents, commands, skills };
}

function scanPluginsDir(dir: string, source: string): PluginInfo[] {
  const plugins: PluginInfo[] = [];
  if (!fs.existsSync(dir)) return plugins;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(dir, entry.name);
    const info = scanPlugin(pluginDir, entry.name, source);
    if (info) plugins.push(info);
  }

  return plugins;
}

/** Scan OpenClaw extensions (installed via `openclaw plugins install`). */
function scanOpenclawExtensions(openclawHome: string): PluginInfo[] {
  const extensionsDir = path.join(openclawHome, "extensions");
  if (!fs.existsSync(extensionsDir)) return [];

  // Read installs metadata from openclaw.json
  const configPath = path.join(openclawHome, "openclaw.json");
  let installsMap: Record<string, Record<string, unknown>> = {};
  let entriesMap: Record<string, Record<string, unknown>> = {};
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      installsMap = cfg?.plugins?.installs || {};
      entriesMap = cfg?.plugins?.entries || {};
    } catch { /* ignore */ }
  }

  const plugins: PluginInfo[] = [];
  for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extDir = path.join(extensionsDir, entry.name);

    // Read package.json for description and version
    let description = "";
    let version: string | undefined;
    const pkgJsonPath = path.join(extDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        description = pkg.description || "";
        version = pkg.version;
      } catch { /* ignore */ }
    }

    const installRecord = installsMap[entry.name] || {};
    const entryConfig = entriesMap[entry.name] || {};

    plugins.push({
      name: entry.name,
      description,
      source: "openclaw-extension",
      version: version || (installRecord.resolvedVersion as string) || undefined,
      installedAt: installRecord.installedAt as string || undefined,
      enabled: entryConfig.enabled !== false,
      agents: [],
      commands: [],
      skills: [],
    });
  }

  return plugins;
}

/** Resolve the openclaw CLI binary path. */
function resolveOpenclawCli(openclawDir?: string): string | null {
  const dir = openclawDir || process.env.OPENCLAW_DIR || process.cwd();
  // Check for openclaw.mjs in the openclaw project dir
  const openclawMjs = path.join(dir, "openclaw.mjs");
  if (fs.existsSync(openclawMjs)) return openclawMjs;
  return null;
}

export function pluginsRoutes(config: BridgeConfig): Router {
  const router = Router();

  // GET /api/plugins — list all plugins (nanobot + openclaw extensions)
  router.get("/plugins", asyncHandler(async (_req, res) => {
    const globalDir = path.join(os.homedir(), ".nanobot", "plugins");
    const workspaceDir = path.join(config.workspacePath, "plugins");

    const globalPlugins = scanPluginsDir(globalDir, "global");
    const workspacePlugins = scanPluginsDir(workspaceDir, "workspace");
    const openclawExtensions = scanOpenclawExtensions(config.openclawHome);

    // Merge: workspace > global, openclaw extensions separate
    const pluginMap = new Map<string, PluginInfo>();
    for (const p of globalPlugins) pluginMap.set(p.name, p);
    for (const p of workspacePlugins) pluginMap.set(p.name, p);
    for (const p of openclawExtensions) pluginMap.set(`ext:${p.name}`, p);

    res.json(Array.from(pluginMap.values()));
  }));

  // POST /api/plugins/install — install an OpenClaw extension (npm package or git URL)
  router.post("/plugins/install", asyncHandler(async (req, res) => {
    const { spec } = req.body as { spec?: string };

    if (!spec || typeof spec !== "string") {
      res.status(400).json({ detail: "spec is required (e.g. '@openclaw/feishu' or a git URL)" });
      return;
    }

    const cliPath = resolveOpenclawCli();
    if (!cliPath) {
      res.status(500).json({ detail: "Cannot find openclaw CLI" });
      return;
    }

    const openclawDir = process.env.OPENCLAW_DIR || process.cwd();
    const isGitUrl = spec.endsWith(".git") || spec.startsWith("git://") || spec.startsWith("git+");

    // For git URLs: clone to temp dir first, then install from local path
    if (isGitUrl) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-git-plugin-"));
      try {
        // Clone the repo
        await new Promise<void>((resolve, reject) => {
          execFile("git", ["clone", "--depth", "1", spec, tmpDir], {
            timeout: 120_000,
          }, (err, _stdout, stderr) => {
            if (err) {
              reject(new Error(`git clone failed: ${stderr || err.message}`));
            } else {
              resolve();
            }
          });
        });

        // Install from the cloned local path
        await new Promise<void>((resolve, reject) => {
          const child = execFile(process.execPath, [cliPath, "plugins", "install", tmpDir], {
            cwd: openclawDir,
            timeout: 180_000,
            env: {
              ...process.env,
              OPENCLAW_CONFIG_PATH: path.join(config.openclawHome, "openclaw.json"),
              OPENCLAW_STATE_DIR: config.openclawHome,
              npm_config_registry: process.env.npm_config_registry || "https://registry.npmmirror.com",
            },
          }, (err, stdout, stderr) => {
            if (err) {
              const output = (stdout || "") + (stderr || "");
              reject(new Error(output || err.message));
            } else {
              const output = (stdout || "") + (stderr || "");
              console.log(`[bridge] Plugin installed from git: ${spec}`);
              res.json({ ok: true, output: output.trim() });
              resolve();
            }
          });
          child.stdin?.write("y\n");
          child.stdin?.end();
        });
      } catch (err: any) {
        console.error(`[bridge] Git plugin install failed: ${err.message}`);
        res.status(500).json({
          detail: `Installation failed: ${err.message}`,
          output: err.message,
        });
      } finally {
        // Clean up temp dir
        try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
      }
      return;
    }

    // Standard npm spec install
    const child = execFile(process.execPath, [cliPath, "plugins", "install", spec], {
      cwd: openclawDir,
      timeout: 180_000,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: path.join(config.openclawHome, "openclaw.json"),
        OPENCLAW_STATE_DIR: config.openclawHome,
        // Use npm mirror for faster downloads in China
        npm_config_registry: process.env.npm_config_registry || "https://registry.npmmirror.com",
      },
    }, (err, stdout, stderr) => {
      if (err) {
        const output = (stdout || "") + (stderr || "");
        console.error(`[bridge] Plugin install failed: ${output}`);
        res.status(500).json({
          detail: `Installation failed: ${err.message}`,
          output: output.trim(),
        });
        return;
      }
      const output = (stdout || "") + (stderr || "");
      console.log(`[bridge] Plugin installed: ${spec}`);
      res.json({ ok: true, output: output.trim() });
    });

    // Feed 'y' to any prompts (security scan confirmation)
    child.stdin?.write("y\n");
    child.stdin?.end();
  }));

  // DELETE /api/plugins/:plugin_name — uninstall a plugin
  router.delete("/plugins/:plugin_name", asyncHandler(async (req, res) => {
    const pluginName = req.params.plugin_name;

    // Try OpenClaw extension first
    const extDir = path.join(config.openclawHome, "extensions", pluginName);
    if (fs.existsSync(extDir)) {
      // Use openclaw CLI to uninstall properly (cleans up config too)
      const cliPath = resolveOpenclawCli();
      if (cliPath) {
        const openclawDir = process.env.OPENCLAW_DIR || process.cwd();
        try {
          await new Promise<void>((resolve, reject) => {
            execFile(process.execPath, [cliPath, "plugins", "uninstall", pluginName], {
              cwd: openclawDir,
              timeout: 30_000,
              env: {
                ...process.env,
                OPENCLAW_CONFIG_PATH: path.join(config.openclawHome, "openclaw.json"),
                OPENCLAW_STATE_DIR: config.openclawHome,
              },
            }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          res.json({ ok: true });
          return;
        } catch {
          // Fallback: remove directory directly
        }
      }
      fs.rmSync(extDir, { recursive: true });
      res.json({ ok: true });
      return;
    }

    // Try nanobot plugin
    const globalDir = path.join(os.homedir(), ".nanobot", "plugins", pluginName);
    if (fs.existsSync(globalDir)) {
      fs.rmSync(globalDir, { recursive: true });
      res.json({ ok: true });
      return;
    }

    res.status(404).json({ detail: "Plugin not installed" });
  }));

  return router;
}
