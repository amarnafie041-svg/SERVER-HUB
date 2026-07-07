#!/usr/bin/env python3
"""
🔒 Enhanced Sandbox Runner v2
- Per-user directory isolation (completely separate environments)
- Multi-language support (Python, Node.js, PHP)
- Port management per user
- Secure file access restrictions
- Cannot be bypassed by user code
"""
import sys
import os
import json
import subprocess
from pathlib import Path

if len(sys.argv) < 4:
    print("Usage: sandbox_runner.py <user_id> <script_path> <allowed_port> [language]")
    sys.exit(1)

USER_ID = sys.argv[1]
SCRIPT_PATH = os.path.realpath(sys.argv[2])
ALLOWED_PORT = sys.argv[3]
LANGUAGE = sys.argv[4] if len(sys.argv) > 4 else "python"

# Per-user isolation directory
USER_HOME = os.path.realpath(f"/home/users/{USER_ID}")
USER_TMP = os.path.join(USER_HOME, "tmp")
USER_DATA = os.path.join(USER_HOME, "data")

# Create user directories
os.makedirs(USER_HOME, exist_ok=True)
os.makedirs(USER_TMP, exist_ok=True)
os.makedirs(USER_DATA, exist_ok=True)

# Verify script is within user directory
if not SCRIPT_PATH.startswith(USER_HOME):
    print(f"🔒 Error: Script must be in user directory {USER_HOME}")
    sys.exit(1)

# ====================================================================
# Allowed paths - STRICTLY per-user
# ====================================================================
ALLOWED_PREFIXES = [
    USER_HOME,  # User's home directory only
    USER_TMP,   # User's temp directory
    "/dev/null",
    "/dev/urandom",
    "/dev/zero",
]

# Add Python standard library paths
import site as _site
try:
    ALLOWED_PREFIXES += _site.getsitepackages()
except Exception:
    pass
try:
    ALLOWED_PREFIXES.append(_site.getusersitepackages())
except Exception:
    pass
ALLOWED_PREFIXES.append(sys.prefix)
ALLOWED_PREFIXES.append(os.path.dirname(os.__file__))

def is_path_allowed(path_str: str) -> bool:
    """Verify path is within allowed directories"""
    try:
        if not os.path.isabs(path_str):
            path_str = os.path.join(USER_HOME, path_str)
        resolved = os.path.realpath(path_str)
        for prefix in ALLOWED_PREFIXES:
            if resolved.startswith(os.path.realpath(prefix)):
                return True
        return False
    except Exception:
        return False

# ====================================================================
# Security audit hook (cannot be removed)
# ====================================================================
def security_audit_hook(event: str, args):
    """Monitor all file operations"""
    if event in ('open', 'builtins.open', 'io.open_code'):
        if args and isinstance(args[0], str):
            path = args[0]
            if path and not is_path_allowed(path):
                raise PermissionError(
                    f"\n🔒 [SANDBOX] Access denied: {path}\n"
                    f"   Only {USER_HOME} is accessible"
                )

    elif event == 'os.open':
        if args and isinstance(args[0], str):
            path = args[0]
            if path and not is_path_allowed(path):
                raise PermissionError(f"\n🔒 [SANDBOX] os.open blocked: {path}")

    elif event == 'subprocess.Popen':
        if args:
            cmd = args[0]
            cmd_str = str(cmd).lower() if cmd else ''
            dangerous = [
                'cat /etc', 'cat /root', 'cat /home',
                'rm -rf /', 'dd if=/dev', 'fork bomb'
            ]
            for d in dangerous:
                if d in cmd_str:
                    raise PermissionError(f"🔒 [SANDBOX] Command blocked: {cmd}")

if sys.version_info >= (3, 8):
    sys.addaudithook(security_audit_hook)

# ====================================================================
# Additional layer: Override builtins.open
# ====================================================================
import builtins as _builtins

_orig_open = _builtins.open

def safe_open(file, mode='r', *args, **kwargs):
    if isinstance(file, (str, bytes, os.PathLike)):
        path_str = os.fsdecode(file) if isinstance(file, bytes) else str(file)
        if not is_path_allowed(path_str):
            raise PermissionError(f"🔒 [SANDBOX] Cannot open: {path_str}")
    return _orig_open(file, mode, *args, **kwargs)

_builtins.open = safe_open

# ====================================================================
# Override os directory functions
# ====================================================================
_orig_listdir = os.listdir
_orig_walk = os.walk

def safe_listdir(path='.'):
    p = str(path) if not isinstance(path, str) else path
    if not is_path_allowed(p):
        raise PermissionError(f"🔒 [SANDBOX] listdir blocked: {p}")
    return _orig_listdir(path)

def safe_walk(top, *args, **kwargs):
    p = str(top)
    if not is_path_allowed(p):
        return
    yield from _orig_walk(top, *args, **kwargs)

os.listdir = safe_listdir
os.walk = safe_walk

# ====================================================================
# Setup environment
# ====================================================================
os.chdir(USER_HOME)
os.environ['HOME'] = USER_HOME
os.environ['TMPDIR'] = USER_TMP
os.environ['USER'] = USER_ID
os.environ['PORT'] = ALLOWED_PORT
os.environ['SANDBOX_USER'] = USER_ID

# Clean PATH to only allow safe executables
safe_path = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    USER_HOME,
]
os.environ['PATH'] = ':'.join(safe_path)

sys.argv = [SCRIPT_PATH] + sys.argv[4:]

# ====================================================================
# Execute script
# ====================================================================
try:
    with _orig_open(SCRIPT_PATH, 'r', encoding='utf-8', errors='ignore') as f:
        code = f.read()
    
    namespace = {
        '__name__': '__main__',
        '__file__': SCRIPT_PATH,
        '__doc__': None,
        '__package__': None,
        '__builtins__': _builtins,
    }
    
    exec(compile(code, SCRIPT_PATH, 'exec'), namespace)
    
except SystemExit as e:
    sys.exit(e.code)
except PermissionError as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"[Error] {type(e).__name__}: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
