#!/usr/bin/env python3
"""OpenClaw 本地开发环境状态检查脚本。

检查所有服务状态：PostgreSQL, OpenClaw Bridge, Platform Gateway, Frontend, Manage Admin。
用法: python check_status.py [--local-only]
"""

import argparse
import socket
import subprocess
import sys

# ── 颜色输出 ──────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RESET  = "\033[0m"

# ── 服务配置（与 start_local.py 一致）────────────────────────────────
SERVICES = {
    "db": {
        "name": "PostgreSQL",
        "port": 5432,
        "color": "\033[34m",
    },
    "bridge": {
        "name": "OpenClaw Bridge",
        "port": 18080,
        "color": "\033[35m",
    },
    "gateway": {
        "name": "Platform Gateway",
        "port": 8080,
        "color": "\033[36m",
    },
    "frontend": {
        "name": "Frontend Dev",
        "port": 3080,
        "color": "\033[33m",
    },
    "manage": {
        "name": "Manage Admin",
        "port": 3081,
        "color": "\033[32m",
    },
}


def check_mark(ok: bool) -> str:
    return f"{GREEN}✓{RESET}" if ok else f"{RED}✗{RESET}"


def warn_mark() -> str:
    return f"{YELLOW}⚠{RESET}"


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _detect_lan_ip() -> str:
    """探测局域网 IP（与 start_local.py 一致）。"""
    _TUNNEL_PREFIXES = ("198.18.", "198.19.", "100.64.")
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not any(ip.startswith(p) for p in _TUNNEL_PREFIXES):
                return ip
    except OSError:
        pass
    return "127.0.0.1"


def run_cmd(cmd: list[str], timeout: int = 5) -> tuple[bool, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, r.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return False, str(e)


# ── 各服务检查 ────────────────────────────────────────────────────────

def check_postgres() -> tuple[bool, str]:
    """检查 PostgreSQL Docker 容器状态。"""
    # 检查容器是否在运行
    ok, out = run_cmd([
        "docker", "ps", "-q", "--filter", "name=^openclaw-local-postgres$",
    ])
    if not ok or not out.strip():
        # 检查是否有已停止的容器
        ok2, out2 = run_cmd([
            "docker", "ps", "-aq", "--filter", "name=^openclaw-local-postgres$",
        ])
        if ok2 and out2.strip():
            return False, "容器已停止"
        return False, "容器不存在"

    # 容器在运行，检查 pg_isready
    ok, out = run_cmd([
        "docker", "exec", "openclaw-local-postgres",
        "pg_isready", "-U", "nanobot", "-d", "nanobot_platform",
    ])
    if ok:
        return True, "运行中，数据库就绪"
    return False, f"容器运行中但数据库未就绪: {out}"


def check_bridge() -> tuple[bool, str]:
    """检查 OpenClaw Bridge (端口 18080)。"""
    if not is_port_in_use(18080):
        return False, "端口 18080 未监听"

    # 尝试 HTTP ping
    try:
        import httpx
        r = httpx.get("http://127.0.0.1:18080/api/ping", timeout=5.0)
        if r.status_code < 400:
            try:
                body = r.json()
                if body.get("message") == "pong":
                    return True, "运行中，API 正常 (pong)"
            except Exception:
                pass
            return True, f"运行中 (HTTP {r.status_code})"
        return True, f"端口已监听，但 API 异常 (HTTP {r.status_code})"
    except ImportError:
        return True, "端口已监听（httpx 未安装，跳过 API 检查）"
    except Exception:
        return True, "端口已监听，API 未响应（可能仍在启动）"


def check_gateway() -> tuple[bool, str]:
    """检查 Platform Gateway (端口 8080)。"""
    if not is_port_in_use(8080):
        return False, "端口 8080 未监听"

    try:
        import httpx
        r = httpx.get("http://127.0.0.1:8080/api/ping", timeout=5.0)
        if r.status_code < 400:
            try:
                body = r.json()
                if body.get("message") == "pong":
                    return True, "运行中，API 正常 (pong)"
            except Exception:
                pass
            return True, f"运行中 (HTTP {r.status_code})"
        return True, f"端口已监听，但 API 异常 (HTTP {r.status_code})"
    except ImportError:
        return True, "端口已监听（httpx 未安装，跳过 API 检查）"
    except Exception:
        return True, "端口已监听，API 未响应（可能仍在启动）"


def check_frontend() -> tuple[bool, str]:
    """检查 Frontend Dev Server (端口 3080)。"""
    if not is_port_in_use(3080):
        return False, "端口 3080 未监听"

    try:
        import httpx
        r = httpx.get("http://127.0.0.1:3080/", timeout=5.0, follow_redirects=True)
        if r.status_code < 400:
            return True, f"运行中 (HTTP {r.status_code})"
        return True, f"端口已监听，但响应异常 (HTTP {r.status_code})"
    except ImportError:
        return True, "端口已监听（httpx 未安装，跳过 HTTP 检查）"
    except Exception:
        return True, "端口已监听"


def check_manage() -> tuple[bool, str]:
    """检查 Manage Admin Dev Server (端口 3081)。"""
    if not is_port_in_use(3081):
        return False, "端口 3081 未监听"

    try:
        import httpx
        r = httpx.get("http://127.0.0.1:3081/", timeout=5.0, follow_redirects=True)
        if r.status_code < 400:
            return True, f"运行中 (HTTP {r.status_code})"
        return True, f"端口已监听，但响应异常 (HTTP {r.status_code})"
    except ImportError:
        return True, "端口已监听（httpx 未安装，跳过 HTTP 检查）"
    except Exception:
        return True, "端口已监听"


# ── 查找进程 PID ─────────────────────────────────────────────────────

def find_pid_on_port(port: int) -> str | None:
    """通过 lsof 查找占用端口的进程 PID。"""
    ok, out = run_cmd(["lsof", "-ti", f":{port}"])
    if ok and out.strip():
        # 可能有多个 PID，取第一个
        return out.strip().split("\n")[0]
    return None


# ── 主入口 ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="OpenClaw 本地开发环境状态检查")
    parser.add_argument("--local-only", action="store_true", help="仅检查本机地址")
    args = parser.parse_args()

    lan_ip = "127.0.0.1" if args.local_only else _detect_lan_ip()

    print(f"\n{BOLD}🔍 OpenClaw 本地开发环境状态检查{RESET}\n")

    checkers = {
        "db": check_postgres,
        "bridge": check_bridge,
        "gateway": check_gateway,
        "frontend": check_frontend,
        "manage": check_manage,
    }

    all_ok = True
    results = []

    for svc_id, checker in checkers.items():
        svc = SERVICES[svc_id]
        ok, msg = checker()

        # 查找 PID（非 Docker 服务）
        pid_info = ""
        if svc_id == "db":
            pid_info = "Docker"
        elif ok:
            pid = find_pid_on_port(svc["port"])
            pid_info = f"PID {pid}" if pid else ""

        results.append((svc_id, ok, msg, pid_info))
        if not ok:
            all_ok = False

    # 打印结果
    print(f"{'=' * 60}")
    for svc_id, ok, msg, pid_info in results:
        svc = SERVICES[svc_id]
        mark = check_mark(ok)
        addr = f"http://{lan_ip}:{svc['port']}"
        pid_str = f"  ({pid_info})" if pid_info else ""
        print(f"  {mark} {svc['color']}{svc['name']:>20}{RESET}  {addr}{pid_str}")
        print(f"     {DIM}{msg}{RESET}")
    print(f"{'=' * 60}")

    # 总结
    ok_count = sum(1 for _, ok, _, _ in results if ok)
    total = len(results)
    if all_ok:
        print(f"\n  {GREEN}{BOLD}所有服务正常 ({ok_count}/{total}){RESET}\n")
    else:
        fail_count = total - ok_count
        print(f"\n  {RED}{BOLD}{fail_count} 个服务异常{RESET}，{ok_count}/{total} 正常\n")

        # 给出修复建议
        for svc_id, ok, msg, _ in results:
            if ok:
                continue
            svc = SERVICES[svc_id]
            if svc_id == "db":
                print(f"  {YELLOW}💡 {svc['name']}: docker start openclaw-local-postgres 或 python start_local.py{RESET}")
            elif svc_id == "bridge":
                print(f"  {YELLOW}💡 {svc['name']}: python start_local.py --only db,bridge{RESET}")
            elif svc_id == "gateway":
                print(f"  {YELLOW}💡 {svc['name']}: python start_local.py --only gateway{RESET}")
            elif svc_id == "frontend":
                print(f"  {YELLOW}💡 {svc['name']}: python start_local.py --only frontend{RESET}")
            elif svc_id == "manage":
                print(f"  {YELLOW}💡 {svc['name']}: python start_local.py --only manage{RESET}")
        print()

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
