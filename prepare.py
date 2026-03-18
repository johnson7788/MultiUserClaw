#!/usr/bin/env python3
"""Nanobot 本地开发环境准备脚本（跨平台：macOS / Linux / Windows）。

检查并自动安装本地开发所需的全部依赖：
  1. Python 版本 ≥ 3.11
  2. Docker 守护进程运行状态
  3. Docker 镜像 postgres:16-alpine, node:22-slim
  4. .env 环境变量配置
  5. uv 包管理器
  6. Platform Gateway Python 依赖
  7. Node.js / npm / pnpm
  8. 前端 node_modules (npm install)
  9. OpenClaw Bridge 依赖 (npm install)
  10. OpenClaw 主项目依赖 (pnpm install)

用法:
  python prepare.py           # 检查并自动修复所有问题
  python prepare.py --check   # 仅检查，不自动修复
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# ── 平台检测 ──────────────────────────────────────────────────────────
IS_WINDOWS = sys.platform == "win32"

# ── 颜色输出 ──────────────────────────────────────────────────────────
if IS_WINDOWS:
    # Windows 默认终端可能不支持 ANSI，尝试启用
    import ctypes
    try:
        ctypes.windll.kernel32.SetConsoleMode(
            ctypes.windll.kernel32.GetStdHandle(-11), 7
        )
        _COLOR = True
    except Exception:
        _COLOR = False
else:
    _COLOR = True

def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text

GREEN  = lambda s: _c("32", s)
RED    = lambda s: _c("31", s)
YELLOW = lambda s: _c("33", s)
CYAN   = lambda s: _c("36", s)
BOLD   = lambda s: _c("1",  s)
DIM    = lambda s: _c("2",  s)

PROJECT_DIR  = Path(__file__).parent.resolve()
PLATFORM_DIR = PROJECT_DIR / "platform"
FRONTEND_DIR = PROJECT_DIR / "frontend"

# ── 输出工具 ──────────────────────────────────────────────────────────

def info(msg: str):
    print(f"  {CYAN('ℹ')} {msg}")

def ok(msg: str):
    print(f"  {GREEN('✓')} {msg}")

def warn(msg: str):
    print(f"  {YELLOW('⚠')} {msg}")

def fail(msg: str):
    print(f"  {RED('✗')} {msg}")

def step(title: str):
    print(f"\n{BOLD(title)}")

def run(*cmd, cwd=None, capture=True) -> "subprocess.CompletedProcess":
    return subprocess.run(
        list(cmd),
        cwd=str(cwd) if cwd else None,
        capture_output=capture,
        text=True,
    )


# ── 检查项定义 ────────────────────────────────────────────────────────

class CheckResult:
    def __init__(self, passed: bool, detail: str = "", fixed: bool = False):
        self.passed = passed
        self.detail = detail
        self.fixed  = fixed


def check_python() -> CheckResult:
    """Python 版本必须 ≥ 3.11。"""
    major, minor = sys.version_info[:2]
    ver = f"{major}.{minor}.{sys.version_info[2]}"
    if (major, minor) >= (3, 11):
        return CheckResult(True, ver)
    return CheckResult(False, f"当前 {ver}，需要 ≥ 3.11（无法自动修复，请升级 Python）")


def check_docker_running() -> CheckResult:
    """Docker 守护进程是否运行。"""
    r = run("docker", "info")
    if r.returncode == 0:
        return CheckResult(True)
    return CheckResult(
        False,
        "Docker 未运行（请手动启动 Docker Desktop 或 dockerd 后重试）",
    )


def check_docker_image(image: str, fix: bool) -> CheckResult:
    """检查 Docker 镜像是否已拉取；若未拉取则 docker pull。"""
    r = run("docker", "images", "-q", image)
    if r.returncode == 0 and r.stdout.strip():
        return CheckResult(True, image)

    if not fix:
        return CheckResult(False, f"镜像 {image} 未找到")

    info(f"正在拉取 {image} ...")
    r = run("docker", "pull", image, capture=False)
    if r.returncode == 0:
        return CheckResult(True, image, fixed=True)
    return CheckResult(False, f"拉取 {image} 失败（exit {r.returncode}）")


ENV_FILE     = PROJECT_DIR / ".env"
ENV_EXAMPLE  = PROJECT_DIR / ".env.example"

# .env 中所有已知的 API Key 变量名
_ALL_API_KEYS = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "DASHSCOPE_API_KEY",
    "AIHUBMIX_API_KEY",
    "MOONSHOT_API_KEY",
    "ZHIPU_API_KEY",
    "HOSTED_VLLM_API_KEY",
]


def _parse_env_file(path: Path) -> dict[str, str]:
    """解析 .env 文件，返回 {KEY: VALUE} 字典（忽略注释和空行）。"""
    result = {}
    if not path.exists():
        return result
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'\"")  # 去除引号
        result[key] = val
    return result


def check_env_file(fix: bool) -> CheckResult:
    """检查 .env 是否存在、API Key 是否已配置。"""
    # 1) .env 文件是否存在
    if not ENV_FILE.exists():
        if not fix:
            return CheckResult(False, f".env 不存在，请复制 .env.example 并填写: cp .env.example .env")
        if ENV_EXAMPLE.exists():
            info("从 .env.example 创建 .env ...")
            import shutil as _sh
            _sh.copy2(ENV_EXAMPLE, ENV_FILE)
            return CheckResult(False, ".env 已从模板创建，请编辑 .env 填写至少一个 API Key 后重试", fixed=True)
        return CheckResult(False, ".env 不存在，且未找到 .env.example 模板")

    # 2) 解析 .env
    env_vars = _parse_env_file(ENV_FILE)
    problems: list[str] = []
    warnings: list[str] = []

    # 3) 检查是否至少配置了一个 API Key
    configured_keys = [k for k in _ALL_API_KEYS if env_vars.get(k)]
    if not configured_keys:
        problems.append("未配置任何 LLM API Key，至少需要一个才能调用大模型")

    # 4) 检查 DEFAULT_MODEL 与 API Key 的匹配
    default_model = env_vars.get("DEFAULT_MODEL", "")
    if default_model and configured_keys:
        # 简单匹配：模型 provider 前缀 → 对应的 API Key
        _MODEL_KEY_MAP = {
            "anthropic":  "ANTHROPIC_API_KEY",
            "openai":     "OPENAI_API_KEY",
            "deepseek":   "DEEPSEEK_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
            "dashscope":  "DASHSCOPE_API_KEY",
            "aihubmix":   "AIHUBMIX_API_KEY",
            "moonshot":   "MOONSHOT_API_KEY",
            "zhipu":      "ZHIPU_API_KEY",
            "vllm":       "HOSTED_VLLM_API_KEY",
        }
        provider = default_model.split("/")[0].lower() if "/" in default_model else ""
        if provider and provider in _MODEL_KEY_MAP:
            required_key = _MODEL_KEY_MAP[provider]
            if not env_vars.get(required_key):
                problems.append(f"DEFAULT_MODEL={default_model}，但 {required_key} 未配置")

    # 5) JWT_SECRET 安全警告
    jwt = env_vars.get("JWT_SECRET", "")
    if jwt and jwt == "change-me-in-production":
        warnings.append("JWT_SECRET 使用默认值，生产部署前请修改")

    # 输出警告
    for w in warnings:
        warn(w)

    if problems:
        return CheckResult(False, "; ".join(problems))

    key_names = ", ".join(k.replace("_API_KEY", "") for k in configured_keys)
    detail = f"已配置 API Key: {key_names}"
    if default_model:
        detail += f" | 默认模型: {default_model}"
    return CheckResult(True, detail)


def check_uv(fix: bool) -> CheckResult:
    """检查 uv 是否已安装；若无则 pip install uv。"""
    if shutil.which("uv"):
        r = run("uv", "--version")
        ver = r.stdout.strip() if r.returncode == 0 else "已安装"
        return CheckResult(True, ver)

    if not fix:
        return CheckResult(False, "uv 未安装")

    info("正在通过 pip 安装 uv ...")
    r = run(sys.executable, "-m", "pip", "install", "uv", "--quiet", capture=False)
    if r.returncode == 0 and shutil.which("uv"):
        return CheckResult(True, "已安装 uv", fixed=True)

    # pip 安装后 uv 可能在脚本目录，尝试 python -m uv
    r2 = run(sys.executable, "-m", "uv", "--version")
    if r2.returncode == 0:
        return CheckResult(True, f"python -m uv ({r2.stdout.strip()})", fixed=True)

    return CheckResult(False, "安装 uv 失败，请手动安装: https://docs.astral.sh/uv/getting-started/installation/")


def _uv_cmd() -> list[str]:
    """返回可用的 uv 命令前缀（全局 uv 或 python -m uv）。"""
    if shutil.which("uv"):
        return ["uv"]
    return [sys.executable, "-m", "uv"]


def check_nanobot_deps(fix: bool) -> CheckResult:
    """通过 uv sync 安装/验证 nanobot 主项目依赖。"""
    # 快速检查：nanobot 包是否已安装到当前 venv
    r = run(*_uv_cmd(), "sync", "--dry-run", cwd=PROJECT_DIR)
    # dry-run 返回 0 且无 "Would install" 则说明已同步
    already_synced = r.returncode == 0 and "Would install" not in r.stdout and "Would install" not in r.stderr

    if already_synced:
        return CheckResult(True, "已同步")

    if not fix:
        return CheckResult(False, "uv sync 未执行或依赖未完整安装")

    info("正在执行 uv sync（nanobot 主项目）...")
    r = run(*_uv_cmd(), "sync", cwd=PROJECT_DIR, capture=False)
    if r.returncode == 0:
        return CheckResult(True, "uv sync 完成", fixed=True)
    return CheckResult(False, f"uv sync 失败（exit {r.returncode}）")


def _is_pkg_installed(pkg_name: str) -> bool:
    """通过 uv pip show 检查包是否已安装到当前 venv。"""
    r = run(*_uv_cmd(), "pip", "show", pkg_name)
    return r.returncode == 0


def check_platform_deps(fix: bool) -> CheckResult:
    """检查 platform gateway (nanobot-platform) 是否已安装到当前 venv。"""
    if _is_pkg_installed("nanobot-platform"):
        return CheckResult(True, "nanobot-platform 已安装")

    if not fix:
        return CheckResult(False, "nanobot-platform 未安装，运行 prepare.py（不带 --check）自动安装")

    info("正在安装 platform 依赖（uv pip install -e platform/）...")
    r = run(*_uv_cmd(), "pip", "install", "-e", str(PLATFORM_DIR), capture=False)
    if r.returncode == 0 and _is_pkg_installed("nanobot-platform"):
        return CheckResult(True, "nanobot-platform 已安装", fixed=True)

    return CheckResult(False, "platform 依赖安装失败，请手动运行: uv pip install -e platform/")


def _which(cmd: str) -> str | None:
    """查找可执行文件路径。优先 shutil.which，Windows 上回退到 PowerShell Get-Command。"""
    path = shutil.which(cmd)
    if path:
        return path
    if IS_WINDOWS:
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"(Get-Command {cmd} -ErrorAction SilentlyContinue).Source"],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0 and r.stdout.strip():
                found = r.stdout.strip()
                # 将找到的目录加到 PATH，使后续 subprocess 调用也能找到
                bin_dir = str(Path(found).parent)
                if bin_dir not in os.environ.get("PATH", ""):
                    os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
                return found
        except Exception:
            pass
    return None


def check_nodejs() -> CheckResult:
    """检查 Node.js (≥ 18) 和 npm 是否已安装。"""
    node = _which("node")
    npm  = _which("npm")

    if not node or not npm:
        missing = []
        if not node: missing.append("node")
        if not npm:  missing.append("npm")
        return CheckResult(
            False,
            f"{', '.join(missing)} 未找到。请安装 Node.js ≥ 18: https://nodejs.org，本地测试时会受影响",
        )

    r = run("node", "--version")
    ver = r.stdout.strip() if r.returncode == 0 else "unknown"

    # 解析主版本号
    try:
        major = int(ver.lstrip("v").split(".")[0])
        if major < 18:
            return CheckResult(
                False,
                f"Node.js {ver}（需要 ≥ 18），请升级: https://nodejs.org",
            )
    except ValueError:
        pass

    r2 = run("npm", "--version")
    npm_ver = r2.stdout.strip() if r2.returncode == 0 else "unknown"
    return CheckResult(True, f"node {ver}, npm {npm_ver}")


def check_frontend_deps(fix: bool) -> CheckResult:
    """检查前端 node_modules 是否存在；若无则 npm install。"""
    nm = FRONTEND_DIR / "node_modules"
    if nm.exists() and any(nm.iterdir()):
        return CheckResult(True, "node_modules 已就绪")

    if not FRONTEND_DIR.exists():
        return CheckResult(False, f"{FRONTEND_DIR} 目录不存在")

    if not fix:
        return CheckResult(False, "node_modules 不存在")

    info("正在执行 npm install（前端依赖）...")
    r = subprocess.run(
        "npm install",
        cwd=str(FRONTEND_DIR),
        shell=True,
        text=True,
    )
    if r.returncode == 0:
        return CheckResult(True, "npm install 完成", fixed=True)
    return CheckResult(False, f"npm install 失败（exit {r.returncode}）")


# ── 主流程 ────────────────────────────────────────────────────────────

OPENCLAW_DIR = PROJECT_DIR / "openclaw"
BRIDGE_DIR   = OPENCLAW_DIR / "bridge"


def check_openclaw_deps(fix: bool) -> CheckResult:
    """检查 openclaw 主项目依赖是否已安装（pnpm install）。"""
    nm = OPENCLAW_DIR / "node_modules"
    if nm.exists() and any(nm.iterdir()):
        return CheckResult(True, "openclaw node_modules 已就绪")

    if not fix:
        return CheckResult(False, "openclaw node_modules 不存在，运行 prepare.py 自动安装")

    pnpm = shutil.which("pnpm")
    if not pnpm:
        # Try installing pnpm first
        info("正在安装 pnpm...")
        subprocess.run("npm install -g pnpm", shell=True, text=True)
        pnpm = shutil.which("pnpm")
        if not pnpm:
            return CheckResult(False, "pnpm 未安装，请先运行: npm install -g pnpm")

    info("正在执行 pnpm install（openclaw 主项目）...")
    r = subprocess.run(
        f"{pnpm} install",
        cwd=str(OPENCLAW_DIR),
        shell=True, text=True,
    )
    if r.returncode == 0:
        return CheckResult(True, "pnpm install 完成", fixed=True)
    return CheckResult(False, f"pnpm install 失败（exit {r.returncode}）")


def check_bridge_deps(fix: bool) -> CheckResult:
    """检查 bridge 依赖是否已安装（npm install in bridge/）。"""
    nm = BRIDGE_DIR / "node_modules"
    if nm.exists() and any(nm.iterdir()):
        return CheckResult(True, "bridge node_modules 已就绪")

    if not BRIDGE_DIR.exists():
        return CheckResult(False, f"{BRIDGE_DIR} 目录不存在")

    # Check if package.json exists (copied from bridge-package.json)
    pkg_json = BRIDGE_DIR / "package.json"
    if not pkg_json.exists():
        bridge_pkg = OPENCLAW_DIR / "bridge-package.json"
        if bridge_pkg.exists():
            if fix:
                info("从 bridge-package.json 复制 package.json...")
                import shutil as _sh
                _sh.copy2(bridge_pkg, pkg_json)
            else:
                return CheckResult(False, "bridge/package.json 不存在")

    if not fix:
        return CheckResult(False, "bridge node_modules 不存在")

    info("正在执行 npm install（bridge 依赖）...")
    r = subprocess.run(
        "npm install",
        cwd=str(BRIDGE_DIR),
        shell=True, text=True,
    )
    if r.returncode == 0:
        return CheckResult(True, "npm install 完成", fixed=True)
    return CheckResult(False, f"npm install 失败（exit {r.returncode}）")


CHECKS = [
    # (display_name,         checker_fn,              requires_docker, requires_uv)
    ("Python 版本",           check_python,             False, False),
    ("Docker 守护进程",       check_docker_running,     False, False),
    ("Docker 镜像",           None,                     True,  False),  # 特殊处理
    ("uv 包管理器",           check_uv,                 False, False),
    ("Platform Python 依赖",  check_platform_deps,      False, False),
    ("Node.js / npm",         check_nodejs,             False, False),
    ("前端 node_modules",     check_frontend_deps,      False, False),
    ("OpenClaw 主项目依赖",   check_openclaw_deps,      False, False),
    ("Bridge 依赖",           check_bridge_deps,        False, False),
]

DOCKER_IMAGES = [
    "postgres:16-alpine",  # 数据库
    "ghcr.io/astral-sh/uv:python3.13-bookworm-slim",  # 后端 platform 网关
    "node:22-slim",  # openclaw-bridge 用户容器
    "node:20-alpine",  # frontend
]


def main():
    parser = argparse.ArgumentParser(description="Nanobot 开发环境准备脚本")
    parser.add_argument("--check", action="store_true", help="仅检查，不自动修复")
    args = parser.parse_args()
    fix = not args.check

    platform_label = "Windows" if IS_WINDOWS else ("macOS" if sys.platform == "darwin" else "Linux")
    print(f"\n{BOLD(f'🔧 Nanobot 开发环境准备 ({platform_label})')}")
    if args.check:
        print(f"  {DIM('模式：仅检查（--check）')}")
    else:
        print(f"  {DIM('模式：检查并自动修复')}")

    results: dict[str, CheckResult] = {}
    docker_ok = False
    uv_ok     = False

    # 1. Python
    step("1. Python 版本")
    r = check_python()
    results["Python 版本"] = r
    if r.passed:
        ok(f"Python {r.detail}")
    else:
        fail(r.detail)

    # 2. Docker 运行状态
    step("2. Docker 守护进程")
    r = check_docker_running()
    results["Docker 守护进程"] = r
    docker_ok = r.passed
    if r.passed:
        ok("Docker 正在运行")
    else:
        fail(r.detail)

    # 3. Docker 镜像
    step("3. Docker 镜像")
    for image in DOCKER_IMAGES:
        key = f"Docker 镜像 ({image})"
        if not docker_ok:
            results[key] = CheckResult(False, "跳过（Docker 未运行）")
            warn(f"{image} — 跳过（Docker 未运行）")
            continue
        r = check_docker_image(image, fix=fix)
        results[key] = r
        if r.passed:
            ok(f"{image}" + (" (已拉取)" if r.fixed else " (已存在)"))
        else:
            fail(f"{image}: {r.detail}")

    # 4. .env 环境变量
    step("4. .env 环境变量配置")
    r = check_env_file(fix=fix)
    results[".env 配置"] = r
    if r.passed:
        ok(r.detail)
    elif r.fixed:
        warn(r.detail)
    else:
        fail(r.detail)

    # 5. uv
    step("5. uv 包管理器")
    r = check_uv(fix=fix)
    results["uv 包管理器"] = r
    uv_ok = r.passed
    if r.passed:
        ok(r.detail + (" (已安装)" if r.fixed else ""))
    else:
        fail(r.detail)

    # 6. Platform 依赖
    step("6. Platform Gateway Python 依赖")
    if not uv_ok:
        results["Platform Python 依赖"] = CheckResult(False, "跳过（uv 不可用）")
        warn("跳过（uv 不可用）")
    else:
        r = check_platform_deps(fix=fix)
        results["Platform Python 依赖"] = r
        if r.passed:
            ok(r.detail)
        else:
            fail(r.detail)

    # 7. Node.js / npm
    step("7. Node.js / npm")
    r = check_nodejs()
    results["Node.js / npm"] = r
    node_ok = r.passed
    if r.passed:
        ok(r.detail)
    else:
        fail(r.detail)

    # 8. 前端 node_modules
    step("8. 前端 node_modules")
    if not node_ok:
        results["前端 node_modules"] = CheckResult(False, "跳过（npm 不可用）")
        warn("跳过（npm 不可用）")
    else:
        r = check_frontend_deps(fix=fix)
        results["前端 node_modules"] = r
        if r.passed:
            ok(r.detail)
        else:
            fail(r.detail)

    # 9. OpenClaw 主项目依赖
    step("9. OpenClaw 主项目依赖")
    if not node_ok:
        results["OpenClaw 主项目依赖"] = CheckResult(False, "跳过（npm 不可用）")
        warn("跳过（npm 不可用）")
    else:
        r = check_openclaw_deps(fix=fix)
        results["OpenClaw 主项目依赖"] = r
        if r.passed:
            ok(r.detail)
        else:
            fail(r.detail)

    # 10. Bridge 依赖
    step("10. Bridge 依赖")
    if not node_ok:
        results["Bridge 依赖"] = CheckResult(False, "跳过（npm 不可用）")
        warn("跳过（npm 不可用）")
    else:
        r = check_bridge_deps(fix=fix)
        results["Bridge 依赖"] = r
        if r.passed:
            ok(r.detail)
        else:
            fail(r.detail)

    # ── 汇总 ──────────────────────────────────────────────────────────
    passed  = [k for k, v in results.items() if v.passed]
    failed  = [k for k, v in results.items() if not v.passed]
    fixed   = [k for k, v in results.items() if v.fixed]

    print(f"\n{'=' * 56}")
    print(BOLD("  准备结果汇总"))
    print(f"{'=' * 56}")
    print(f"  {GREEN('通过')}: {len(passed)} / {len(results)}")
    if fixed:
        print(f"  {CYAN('自动修复')}: {len(fixed)} 项")
        for k in fixed:
            print(f"    {CYAN('→')} {k}")
    if failed:
        print(f"  {RED('失败')}: {len(failed)} 项")
        for k in failed:
            detail = results[k].detail
            print(f"    {RED('✗')} {k}" + (f": {detail}" if detail else ""))
    print(f"{'=' * 56}\n")

    if not failed:
        print(GREEN("✓ 环境已就绪，可以运行 python start_local.py"))
    else:
        manual = [k for k in failed if not any(
            hint in results[k].detail for hint in ("跳过", "")
        )]
        print(RED("✗ 存在未解决的问题，请根据上方提示手动处理后重试"))
        sys.exit(1)


if __name__ == "__main__":
    main()
