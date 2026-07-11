#!/usr/bin/env python3
"""
🔒 Sandbox Runner — تشغيل ملفات المستخدمين في بيئة معزولة
يمنع كود المستخدم من قراءة/كتابة/حذف أي ملف خارج مجلده الشخصي،
باستخدام sys.addaudithook (لا يمكن إزالته بعد التسجيل) + طبقة حماية
ثانية على أهم دوال os/builtins.open كـ defense-in-depth.

⚠️ حدود مهمة — اقرأها قبل ما تعتمد عليه بشكل كامل:
هذا الملف حماية على مستوى "وصول الملفات" داخل نفس عملية بايثون.
هو مش عزل نظام تشغيل حقيقي (container/chroot/namespaces)، ولذلك في حدود
معروفة ومقصودة:
  • أي subprocess/os.system بيشغّل عملية فرعية منفصلة — الـ audit hook
    بيقدر يفحص *الأمر* قبل ما يتشغّل، لكن مش هيقدر يراقب حاجة بعد كده
    جوه العملية الفرعية نفسها (لأنها عملية تانية تمامًا).
  • ctypes/cffi ممكن تستخدم لاستدعاء نظام التشغيل مباشرة متجاوزة أي
    Hook بايثوني بالكامل.
  • كود بايثون شرير جدًا وعنده وقت كافي يقدر نظريًا يوصل لأي كائن حي
    في العملية عن طريق gc.get_objects() ويحاول يعدّل فيه.
الحل الوحيد لعزل صلب 100% هو تشغيل كل مستخدم جوه Docker/gVisor/Firecracker
منفصل — بالظبط زي الموصوف في SECURITY.md بتاع المشروع بخصوص التيرمينال.
اعتبر الملف ده طبقة حماية إضافية قوية ضد الأخطاء والمحاولات العادية،
مش ضمان أمني مطلق ضد مهاجم محترف عنده وقت غير محدود.
"""
import sys
import os

if len(sys.argv) < 3:
    print("Usage: sandbox_runner.py <allowed_dir> <script_path>")
    sys.exit(1)

_ARG_ALLOWED_DIR = os.path.realpath(sys.argv[1])
_ARG_SCRIPT_PATH = os.path.realpath(sys.argv[2])

# 🔒 فحص حدود المسار — إصلاح "bug الـ prefix" المعروف في المشروع:
# لازم يكون تطابق تام أو مسار فرعي حقيقي (بعد os.sep)، مش startswith عادي
# (وإلا users_data/bob2 كان هيتطابق مع users_data/bob).
if not (_ARG_SCRIPT_PATH == _ARG_ALLOWED_DIR or
        _ARG_SCRIPT_PATH.startswith(_ARG_ALLOWED_DIR + os.sep)):
    print("🔒 خطأ: الملف يجب أن يكون داخل مجلد المستخدم")
    sys.exit(1)


def _install_sandbox(allowed_dir, script_path):
    """
    كل الحالة الحساسة أمنيًا (allowed_prefixes / is_path_allowed / الـ hook
    نفسه) بتتعرّف *جوه* الدالة دي كمتغيرات محلية (closure)، مش كـ module
    globals. الهدف: كود المستخدم بيشتغل جوه exec() في namespace منفصل،
    لكنه برضو يقدر يوصل لـ sys.modules['__main__'] (نفس السكريبت ده) —
    فلو المتغيرات دي كانت globals عادية كان أي كود مستخدم يقدر يعمل مثلاً:
        sys.modules['__main__'].ALLOWED_PREFIXES.append('/')
    ويلغي الحماية بالكامل بسطر واحد. لما تبقى closure، المهاجم محتاج
    يمشي على gc.get_objects() ويلاقي الـ function ويعدّل __closure__
    مباشرة — ممكن نظريًا لكن أصعب بكتير من مجرد تعديل attribute.
    """
    import builtins as _builtins
    import site as _site
    import shlex as _shlex

    allowed_prefixes = [
        allowed_dir,
        '/tmp',
        '/dev/null',
        '/dev/urandom',
        '/dev/zero',
        '/proc/self',
    ]
    try:
        allowed_prefixes += _site.getsitepackages()
    except Exception:
        pass
    try:
        allowed_prefixes.append(_site.getusersitepackages())
    except Exception:
        pass
    allowed_prefixes.append(sys.prefix)
    allowed_prefixes.append(os.path.dirname(os.__file__))

    # tuple ثابت (immutable) بعد التطبيع — مفيش list يتم mutate فيه لاحقًا
    resolved_prefixes = tuple(sorted({
        os.path.realpath(p) for p in allowed_prefixes if p
    }))

    def _to_str(value):
        if isinstance(value, bytes):
            try:
                return os.fsdecode(value)
            except Exception:
                return repr(value)
        if isinstance(value, os.PathLike):
            try:
                return os.fspath(value)
            except Exception:
                return repr(value)
        return value

    def is_path_allowed(path_val) -> bool:
        """هل المسار مسموح للوصول؟ فشل التحقق = رفض (fail-closed)."""
        try:
            path_str = _to_str(path_val)
            if not isinstance(path_str, str):
                # نوع غير متوقع (زي وصف ملف رقمي fd) — امنع، مش نفترض إنه آمن
                return False
            if not os.path.isabs(path_str):
                path_str = os.path.join(allowed_dir, path_str)
            resolved = os.path.realpath(path_str)
            for prefix in resolved_prefixes:
                # تطابق تام أو مسار فرعي حقيقي فقط — مش startswith خام
                if resolved == prefix or resolved.startswith(prefix + os.sep):
                    return True
            return False
        except Exception:
            return False  # fail-closed بدل fail-open

    # أحداث الـ audit اللي بتتعلق بمسار ملف كـ أول argument
    _PATH_EVENTS = (
        'open', 'builtins.open', 'io.open_code', 'os.open',
        'os.remove', 'os.rmdir', 'os.mkdir', 'os.rename', 'os.replace',
        'os.chmod', 'os.chown', 'os.link', 'os.symlink', 'os.truncate',
        'os.listdir', 'os.scandir', 'os.readlink',
        'shutil.copyfile', 'shutil.move', 'shutil.rmtree',
    )

    _DANGEROUS_CMD_SNIPPETS = (
        'cat /etc', 'cat /root', 'cat /home', 'cp /etc', 'cp /root',
        'scp ', 'rsync ', 'curl -x post', 'wget --post',
        '/etc/passwd', '/etc/shadow', 'nc -e', 'ncat -e',
        '/root/.ssh', '.ssh/id_rsa', '.ssh/id_ed25519',
    )

    def _cmd_tokens(cmd):
        try:
            if isinstance(cmd, (list, tuple)):
                return [str(_to_str(c)) for c in cmd]
            return _shlex.split(str(_to_str(cmd)))
        except Exception:
            return [str(cmd)]

    def _cmd_is_dangerous(cmd) -> bool:
        tokens = _cmd_tokens(cmd)
        joined = ' '.join(tokens).lower()
        for snippet in _DANGEROUS_CMD_SNIPPETS:
            if snippet in joined:
                return True
        # أي مسار مطلق داخل الأمر بيشاور لخارج مجلد المستخدم = ممنوع
        # (أقوى بكتير من قايمة كلمات ثابتة، وبيغطي bash -c "cat /etc/x" إلخ)
        for tok in tokens:
            if tok.startswith('/') and not is_path_allowed(tok):
                return True
        return False

    def _security_audit_hook(event: str, args):
        if event in _PATH_EVENTS:
            if args:
                path = args[0]
                if isinstance(path, (str, bytes, os.PathLike)) and not is_path_allowed(path):
                    raise PermissionError(
                        f"\n🔒 [SANDBOX] عملية ملف محظورة ({event}): {_to_str(path)}\n"
                        f"   المسموح به فقط: مجلدك الشخصي + مكتبات Python"
                    )

        elif event == 'subprocess.Popen':
            # الشكل الحقيقي: (executable, args_list, cwd, env)
            # args[0] بس اسم البرنامج المحلول (مثلاً 'cat') من غير الوسائط،
            # لازم نفحص args[1] (القائمة الكاملة) عشان نمسك 'cat /etc/passwd'
            full_cmd = args[1] if len(args) > 1 and args[1] else (args[0] if args else None)
            if full_cmd is not None and _cmd_is_dangerous(full_cmd):
                raise PermissionError(f"🔒 [SANDBOX] أمر محظور: {full_cmd}")

        elif event == 'os.system':
            if args and _cmd_is_dangerous(args[0]):
                raise PermissionError(f"🔒 [SANDBOX] أمر محظور: {args[0]}")

        elif event in ('os.posix_spawn', 'os.exec'):
            # الشكل: (path, argv, env, ...) — نفحص argv الكامل مش بس path
            argv = args[1] if len(args) > 1 else (args[0] if args else None)
            if argv is not None and _cmd_is_dangerous(argv):
                raise PermissionError(f"🔒 [SANDBOX] أمر محظور: {argv}")

        elif event == 'glob.glob':
            if args and isinstance(args[0], str):
                pattern = args[0]
                base = os.path.dirname(pattern) or pattern
                if not is_path_allowed(base):
                    raise PermissionError(f"🔒 [SANDBOX] glob محظور: {pattern}")

    # تسجيل الـ hook — مش قابل للإزالة بعد السطر ده (PEP 578)
    sys.addaudithook(_security_audit_hook)

    # ── طبقة حماية ثانية على builtins.open ──────────────────────────────
    _orig_open = _builtins.open

    def _safe_open(file, mode='r', *a, **kw):
        if isinstance(file, (str, bytes, os.PathLike)) and not is_path_allowed(file):
            raise PermissionError(f"🔒 [SANDBOX] ممنوع فتح: {_to_str(file)}")
        return _orig_open(file, mode, *a, **kw)

    _builtins.open = _safe_open

    # ── طبقة حماية ثانية على أهم دوال os اللي بتتعامل مع مسار ──────────
    def _make_guard(name, orig):
        def _guard(path, *a, **kw):
            if not is_path_allowed(path):
                raise PermissionError(f"🔒 [SANDBOX] ممنوع {name}: {_to_str(path)}")
            return orig(path, *a, **kw)
        return _guard

    for _name in ('listdir', 'scandir', 'remove', 'unlink', 'rmdir',
                  'mkdir', 'makedirs', 'rename', 'replace', 'chmod'):
        _orig_fn = getattr(os, _name, None)
        if _orig_fn is not None:
            setattr(os, _name, _make_guard(_name, _orig_fn))

    _orig_walk = os.walk

    def _safe_walk(top, *a, **kw):
        if not is_path_allowed(top):
            return
        yield from _orig_walk(top, *a, **kw)

    os.walk = _safe_walk

    return _orig_open


# تنفيذ الإعداد — لاحظ إن الإرجاع هنا (open الأصلي) مضمون برضو من الـ
# audit hook، لأن حدث 'open' بيتولّد من جوه تنفيذ open() نفسها بغض النظر
# عن أي اسم استُخدم لاستدعائها.
_orig_open = _install_sandbox(_ARG_ALLOWED_DIR, _ARG_SCRIPT_PATH)

# ====================================================================
# تشغيل الـ Script في بيئة نظيفة
# ====================================================================
os.chdir(_ARG_ALLOWED_DIR)
os.environ['HOME'] = _ARG_ALLOWED_DIR
os.environ['TMPDIR'] = _ARG_ALLOWED_DIR

# إزالة مسارات البانيل من PATH
sys.path = [p for p in sys.path if 'panel_data' not in p]
sys.path.insert(0, _ARG_ALLOWED_DIR)

# تعديل argv عشان الـ script يشوف نفسه كـ main
sys.argv = [_ARG_SCRIPT_PATH] + sys.argv[3:]

# تحميل وتشغيل كود المستخدم
with _orig_open(_ARG_SCRIPT_PATH, 'r', encoding='utf-8', errors='ignore') as _f:
    _user_code = _f.read()

_namespace = {
    '__name__': '__main__',
    '__file__': _ARG_SCRIPT_PATH,
    '__doc__': None,
    '__package__': None,
    '__spec__': None,
    '__builtins__': __builtins__,
}

try:
    exec(compile(_user_code, _ARG_SCRIPT_PATH, 'exec'), _namespace)
except SystemExit as _e:
    sys.exit(_e.code)
except PermissionError as _e:
    print(str(_e), file=sys.stderr)
    sys.exit(1)
except Exception as _e:
    print(f"[Error] {type(_e).__name__}: {_e}", file=sys.stderr)
    sys.exit(1)
