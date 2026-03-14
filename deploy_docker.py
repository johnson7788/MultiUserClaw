#!/usr/bin/env python3
"""OpenClaw Docker 部署脚本。

构建 openclaw 基础镜像并通过 docker compose 启动所有服务（postgres + gateway + frontend）。
支持本地部署和远程服务器部署（通过 SSH）。

用法:
  # 本地部署（默认端口 gateway:8080, frontend:3080）
  python deploy_docker.py

  # 指定服务器 IP（会自动设置 VITE_API_URL）
  python deploy_docker.py --host 192.168.1.160

  # 反向代理场景：前端使用相对路径（如 /api/...）
  python deploy_docker.py --host 117.133.60.219 --relative-api

  # 使用 prod compose 文件
  python deploy_docker.py --host 117.133.60.219 --compose docker-compose.yml.prod

  # 仅构建基础镜像不启动
  python deploy_docker.py --build-only

  # 仅重启服务
  python deploy_docker.py --restart

  # 重建指定服务（逗号分隔，openclaw 表示基础镜像）
  python deploy_docker.py --rebuild openclaw,gateway,frontend --host 192.168.1.160
  python deploy_docker.py --rebuild gateway --host 117.133.60.219
  python deploy_docker.py --rebuild frontend

  # 完全清理重建
  python deploy_docker.py --clean
"""

import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import time

# ── 颜色输出 ──────────────────────────────────────────────────────────
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
BOLD = "\033[1m"
RESET = "\033[0m"

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


def resolve_vite_api_url(host: str, gateway_port: int, relative_api: bool) -> str:
    """Resolve frontend API base URL for build args.

    - relative_api=True  -> ""  (frontend uses relative path, e.g. /api/auth/login)
    - relative_api=False -> "http://{host}:{gateway_port}"
    """
    if relative_api:
        return ""
    return f"http://{host}:{gateway_port}"


def log(msg: str, color: str = CYAN):
    print(f"{color}{BOLD}▸{RESET} {msg}")


def success(msg: str):
    print(f"{GREEN}✓{RESET} {msg}")


def error(msg: str):
    print(f"{RED}✗{RESET} {msg}")


def warn(msg: str):
    print(f"{YELLOW}⚠{RESET} {msg}")


def run(cmd: str | list[str], cwd: str | None = None, check: bool = True, **kwargs) -> subprocess.CompletedProcess:
    """执行命令并实时输出。"""
    if isinstance(cmd, str):
        cmd_display = cmd
    else:
        cmd_display = " ".join(cmd)
    log(f"执行: {cmd_display}")
    result = subprocess.run(
        cmd if isinstance(cmd, list) else cmd,
        cwd=cwd or PROJECT_DIR,
        shell=isinstance(cmd, str),
        check=False,
        **kwargs,
    )
    if check and result.returncode != 0:
        error(f"命令失败 (exit {result.returncode}): {cmd_display}")
        sys.exit(1)
    return result


def check_prerequisites():
    """检查 docker 和 docker compose 是否可用。"""
    log("检查前置依赖...")

    for cmd, name in [("docker --version", "Docker"), ("docker compose version", "Docker Compose")]:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            error(f"{name} 未安装或无法访问")
            sys.exit(1)
        success(f"{name}: {result.stdout.strip()}")

    # 检查 docker daemon
    result = subprocess.run("docker info", shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        error("Docker daemon 未运行，请先启动 Docker")
        sys.exit(1)
    success("Docker daemon 运行中")


def check_env_file():
    """检查 .env 文件是否存在且包含至少一个 API Key。"""
    env_path = os.path.join(PROJECT_DIR, ".env")
    if not os.path.exists(env_path):
        warn(".env 文件不存在，将使用默认配置")
        warn("建议创建 .env 文件并配置至少一个 LLM API Key")
        return

    with open(env_path) as f:
        content = f.read()

    key_vars = [
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
    found_keys = []
    for var in key_vars:
        for line in content.splitlines():
            line = line.strip()
            if line.startswith(f"{var}=") and not line.endswith("=") and "xxxx" not in line:
                found_keys.append(var)
                break

    if found_keys:
        success(f".env 已配置 API Key: {', '.join(found_keys)}")
    else:
        warn(".env 中未找到有效的 API Key，请确认配置")



def sync_deploy_copy_to_bridge():
    """将 deploy_copy 内容复制到 openclaw/bridge-deploy-copy/，
    供 Dockerfile 和 entrypoint 在容器启动时同步到用户 ~/.openclaw/。
    """
    deploy_dir = os.path.join(PROJECT_DIR, "deploy_copy")
    if not os.path.isdir(deploy_dir):
        return

    dst = os.path.join(PROJECT_DIR, "openclaw", "bridge-deploy-copy")
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(deploy_dir, dst)
    success(f"deploy_copy → openclaw/bridge-deploy-copy/ 已同步")


def build_openclaw_image():
    """构建 openclaw 基础镜像（用户容器使用）。"""
    log("构建 openclaw:latest 基础镜像...")
    run("docker build --no-cache -f openclaw/Dockerfile.bridge -t openclaw:latest openclaw/")
    success("openclaw:latest 构建完成")


def _build_task(name: str, cmd: str):
    """在子线程中执行构建命令，返回 (name, returncode, elapsed)。"""
    log(f"[并行] 开始构建: {name}")
    start = time.time()
    result = subprocess.run(cmd, shell=True, cwd=PROJECT_DIR)
    elapsed = time.time() - start
    if result.returncode == 0:
        success(f"[并行] {name} 构建完成 ({elapsed:.0f}s)")
    else:
        error(f"[并行] {name} 构建失败 (exit {result.returncode}, {elapsed:.0f}s)")
    return name, result.returncode, elapsed


def build_and_start(compose_file: str, host: str, gateway_port: int, frontend_port: int):
    """构建并启动所有 compose 服务。"""
    api_url = f"http://{host}:{gateway_port}"
    log(f"Frontend VITE_API_URL = {api_url}")
    os.environ["VITE_API_URL"] = api_url

    compose_args = f"-f {compose_file}"

    log(f"使用 {compose_file} 并行构建所有镜像...")
    run(f"docker compose {compose_args} build --parallel")
    run(f"docker compose {compose_args} up -d")
    success("所有服务已启动")


def rebuild_service(compose_file: str, service: str, host: str | None = None, gateway_port: int | None = None):
    """重建并重启指定服务。"""
    if host and gateway_port:
        api_url = f"http://{host}:{gateway_port}"
        os.environ["VITE_API_URL"] = api_url
        log(f"VITE_API_URL = {api_url}")
    compose_args = f"-f {compose_file}"
    log(f"重建服务: {service}...")
    run(f"docker compose {compose_args} build --no-cache {service}")
    run(f"docker compose {compose_args} up -d {service}")
    success(f"服务 {service} 已重建并启动")


def restart_services(compose_file: str):
    """重启所有服务。"""
    compose_args = f"-f {compose_file}"
    log("重启所有服务...")
    run(f"docker compose {compose_args} restart")
    success("所有服务已重启")


def clean_all(compose_file: str):
    """停止所有服务并清理数据。"""
    compose_args = f"-f {compose_file}"
    warn("即将停止所有服务并删除数据卷...")

    response = input("确认要清理所有数据？(y/N): ").strip().lower()
    if response != "y":
        log("取消操作")
        return

    log("停止 compose 服务并删除卷...")
    run(f"docker compose {compose_args} down -v", check=False)

    log("清理用户容器...")
    result = subprocess.run(
        'docker ps -a --filter "name=openclaw-user-" -q',
        shell=True, capture_output=True, text=True, cwd=PROJECT_DIR,
    )
    container_ids = result.stdout.strip()
    if container_ids:
        run(f"docker rm -f {container_ids}", check=False)
        success("用户容器已清理")
    else:
        log("无用户容器需要清理")

    success("清理完成")


def health_check(host: str, gateway_port: int, frontend_port: int, retries: int = 30):
    """等待服务就绪并检查健康状态。"""
    import urllib.request
    import json

    log("等待服务就绪...")

    # 等待 gateway
    gateway_url = f"http://{host}:{gateway_port}/api/ping"
    for i in range(1, retries + 1):
        try:
            req = urllib.request.Request(gateway_url)
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read())
                if data.get("message") == "pong":
                    success(f"Gateway 就绪: {gateway_url}")
                    break
        except Exception:
            pass
        if i < retries:
            sys.stdout.write(f"\r  等待 Gateway... ({i}/{retries})")
            sys.stdout.flush()
            time.sleep(2)
    else:
        print()
        error(f"Gateway 未就绪: {gateway_url}")
        return False

    # 等待 frontend
    frontend_url = f"http://{host}:{frontend_port}"
    for i in range(1, retries + 1):
        try:
            req = urllib.request.Request(frontend_url)
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status < 400:
                    success(f"Frontend 就绪: {frontend_url}")
                    break
        except Exception:
            pass
        if i < retries:
            sys.stdout.write(f"\r  等待 Frontend... ({i}/{retries})")
            sys.stdout.flush()
            time.sleep(2)
    else:
        print()
        error(f"Frontend 未就绪: {frontend_url}")
        return False

    return True


def show_status(compose_file: str, host: str, gateway_port: int, frontend_port: int):
    """显示部署状态摘要。"""
    compose_args = f"-f {compose_file}"
    print(f"\n{BOLD}{'=' * 50}{RESET}")
    print(f"{BOLD}  OpenClaw 部署状态{RESET}")
    print(f"{'=' * 50}")
    print(f"  Frontend:  http://{host}:{frontend_port}")
    print(f"  Gateway:   http://{host}:{gateway_port}")
    print(f"  Compose:   {compose_file}")
    print(f"{'=' * 50}\n")

    run(f"docker compose {compose_args} ps", check=False)
    print()


def main():
    parser = argparse.ArgumentParser(
        description="OpenClaw Docker 部署脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--host", default="localhost", help="服务器 IP 或域名 (默认: localhost)")
    parser.add_argument("--compose", default="docker-compose.yml", help="compose 文件 (默认: docker-compose.yml)")
    parser.add_argument("--gateway-port", type=int, default=None, help="Gateway 端口 (默认: 从 compose 文件读取)")
    parser.add_argument("--frontend-port", type=int, default=3080, help="Frontend 端口 (默认: 3080)")
    parser.add_argument(
        "--relative-api",
        action="store_true",
        help="前端使用相对 API 路径（VITE_API_URL 为空，适合反向代理/SSL 场景）",
    )
    parser.add_argument("--build-only", action="store_true", help="仅构建镜像，不启动服务")
    parser.add_argument("--restart", action="store_true", help="仅重启服务")
    parser.add_argument("--rebuild", metavar="SERVICES", help="重建指定服务，逗号分隔 (openclaw,gateway,frontend)")
    parser.add_argument("--clean", action="store_true", help="停止所有服务并清理数据")
    parser.add_argument("--skip-base", action="store_true", help="跳过构建 openclaw 基础镜像")
    parser.add_argument("--skip-health", action="store_true", help="跳过健康检查")
    parser.add_argument("--status", action="store_true", help="仅显示当前状态")
    args = parser.parse_args()

    # 推断 gateway 端口
    if args.gateway_port is None:
        if "prod" in args.compose:
            args.gateway_port = 8100
        else:
            args.gateway_port = 8080

    os.chdir(PROJECT_DIR)

    print(f"\n{BOLD}🚀 OpenClaw Docker 部署{RESET}\n")

    # 仅显示状态
    if args.status:
        show_status(args.compose, args.host, args.gateway_port, args.frontend_port)
        return

    check_prerequisites()

    # 清理
    if args.clean:
        clean_all(args.compose)
        return

    # 重启
    if args.restart:
        restart_services(args.compose)
        show_status(args.compose, args.host, args.gateway_port, args.frontend_port)
        return

    # 重建指定服务（逗号分隔）
    if args.rebuild:
        services = [s.strip() for s in args.rebuild.split(",") if s.strip()]

        # 同步 deploy_copy
        sync_deploy_copy_to_bridge()

        # "openclaw" 表示重建基础镜像 + 清理旧用户容器
        if "openclaw" in services:
            build_openclaw_image()
            services.remove("openclaw")

            # 清理旧用户容器（它们用的是旧镜像）
            log("清理旧用户容器...")
            result = subprocess.run(
                'docker ps -a --filter "name=openclaw-user-" -q',
                shell=True, capture_output=True, text=True, cwd=PROJECT_DIR,
            )
            container_ids = result.stdout.strip()
            if container_ids:
                run(f"docker rm -f {container_ids}", check=False)
                success("旧用户容器已清理")

            # 清理 DB 中的容器记录
            log("清理数据库容器记录...")
            run('docker exec openclaw-postgres psql -U nanobot -d nanobot_platform -c "DELETE FROM containers;"', check=False)
            success("数据库容器记录已清理")

        # 设置 VITE_API_URL（frontend 构建需要）
        if args.host and args.gateway_port:
            api_url = resolve_vite_api_url(args.host, args.gateway_port, args.relative_api)
            os.environ["VITE_API_URL"] = api_url
            log("VITE_API_URL = <relative path>" if args.relative_api else f"VITE_API_URL = {api_url}")

        # 重建 compose 服务
        if services:
            compose_args = f"-f {args.compose}"
            services_str = " ".join(services)
            log(f"重建服务: {services_str}...")
            run(f"docker compose {compose_args} build --parallel --no-cache {services_str}")
            run(f"docker compose {compose_args} up -d {services_str}")
            success(f"服务 {services_str} 已重建并启动")

        show_status(args.compose, args.host, args.gateway_port, args.frontend_port)
        return

    check_env_file()

    # 同步 deploy_copy 到 bridge 构建目录
    sync_deploy_copy_to_bridge()

    # 设置 VITE_API_URL（frontend 构建需要）
    api_url = resolve_vite_api_url(args.host, args.gateway_port, args.relative_api)
    os.environ["VITE_API_URL"] = api_url
    log("VITE_API_URL = <relative path>" if args.relative_api else f"VITE_API_URL = {api_url}")

    compose_args = f"-f {args.compose}"

    if not args.skip_base:
        # 并行构建: openclaw 基础镜像 + compose 服务
        log("并行构建 openclaw 基础镜像 + compose 服务...")
        tasks = {
            "openclaw:latest": "docker build --no-cache -f openclaw/Dockerfile.bridge -t openclaw:latest openclaw/",
            "compose services": f"docker compose {compose_args} build --parallel",
        }
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(tasks)) as pool:
            futures = {pool.submit(_build_task, name, cmd): name for name, cmd in tasks.items()}
            failed = []
            for future in concurrent.futures.as_completed(futures):
                name, rc, elapsed = future.result()
                if rc != 0:
                    failed.append(name)
        if failed:
            error(f"以下构建失败: {', '.join(failed)}")
            sys.exit(1)
        success("所有镜像并行构建完成")
    else:
        # 仅构建 compose 服务
        log(f"使用 {args.compose} 构建 compose 服务...")
        run(f"docker compose {compose_args} build --parallel")

    if args.build_only:
        log("仅构建模式，跳过启动")
        return

    # 启动服务
    run(f"docker compose {compose_args} up -d")
    success("所有服务已启动")

    # 健康检查
    if not args.skip_health:
        check_host = "localhost" if args.host in ("0.0.0.0",) else args.host
        health_check(check_host, args.gateway_port, args.frontend_port)

    show_status(args.compose, args.host, args.gateway_port, args.frontend_port)


if __name__ == "__main__":
    main()
