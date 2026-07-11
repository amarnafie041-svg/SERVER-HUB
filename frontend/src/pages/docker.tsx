import { Shield, Lock, Eye, FileCheck, Box, Layers, ShieldCheck, TerminalSquare } from "lucide-react";

function SecurityLayer({ icon: Icon, color, title, desc, items }: { icon: any; color: string; title: string; desc: string; items: { label: string; desc: string }[] }) {
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: `${color}25`, background: "rgba(20,10,36,0.4)" }}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{title}</h3>
      </div>
      <p className="text-[11px] text-zinc-400 leading-relaxed">{desc}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border p-2.5" style={{ borderColor: "rgba(139,92,246,0.1)", background: "rgba(15,5,28,0.5)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              <span className="text-[10px] font-bold text-zinc-300">{item.label}</span>
            </div>
            <p className="text-[10px] text-zinc-500 leading-relaxed pr-3">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DockerPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: "rgba(139,92,246,0.2)" }}>
        <ShieldCheck className="w-5 h-5 text-green-400" />
        <h1 className="text-sm font-bold text-white">الأمان والعزل</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Header Card */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(34,197,94,0.1)" }}>
            <ShieldCheck className="w-7 h-7 text-green-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">عزل المستخدمين والأمان</h2>
            <p className="text-[11px] text-zinc-500">تفاصيل حماية بياناتك وشفرتك</p>
          </div>
        </div>

        {/* Intro */}
        <div className="rounded-xl border p-4" style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.03)" }}>
          <p className="text-xs text-zinc-300 leading-relaxed">
            كل مستخدم على Server-Hub يحصل على <span className="text-green-400 font-semibold">بيئة سندبود معزولة بالكامل</span>.
            ملفاتك وشفرتك وعملياتك منفصلة تماماً عن المستخدمين الآخرين.
            لا يمكن لأي مستخدم الوصول لبياناتك أو قراءتها أو تعديلها أو حذفها.
            تفاصيل كل طبقة حمايةأدناه.
          </p>
        </div>

        {/* Layer 1 */}
        <SecurityLayer
          icon={Box}
          color="#a855f7"
          title="الطبقة الأولى: عزل الحاوية (Docker)"
          desc="كل مستخدم يحصل على حاوية Docker مخصصة تعمل بيئة Linux خاصة بها. الحوامل توفر عزل على مستوى العمليات باستخدام kernel namespaces و cgroups."
          items={[
            { label: "نظام ملفات للقراءة فقط", desc: "جذر نظام ملفات الحاوية للقراءة فقط. كل عمليات الكتابة تذهب إلى tmpfs mounts معزولة في /tmp و /home/runner و /var/tmp و /run." },
            { label: "إسقاط القدرات", desc: "جميع قدرات Linux مسقطة (CapDrop ALL). فقط NET_BIND_SERVICE و CHOWN و SETUID و SETGID و DAC_OVERRIDE مسموح بها." },
            { label: "منع تصعيد الصلاحيات", desc: "خيار الأمان 'no-new-privileges:true' يمنع العمليات من الحصول على صلاحيات جديدة عبر setuid binaries." },
            { label: "حد الذاكرة: 512MB", desc: "كل حاوية محدودة بـ 512MB RAM + 512MB swap. الحاوية تُقتل عند تجاوز هذا الحد." },
            { label: "حد المعالج: 0.5 نواة", desc: "كل حاوية محدودة بنصف نواة معالج. مشاركة عادلة للموارد بين جميع المستخدمين." },
            { label: "حد العمليات: 200", desc: "حد أقصى 200 عملية لكل حاوية. يمنع fork bombs والعمليات الهاربة." },
            { label: "الملفات المفتوحة: 2048", desc: "حد أقصى 2048 ملف مفتوح لكل حاوية." },
            { label: "إعادة التشغيل التلقائية", desc: "الحوامل تعيد التشغيل تلقائياً عند التعطل مع حد أقصى 5 محاولات. بيئةك تبقى متاحة." },
          ]}
        />

        {/* Layer 2 */}
        <SecurityLayer
          icon={FileCheck}
          color="#3b82f6"
          title="الطبقة الثانية: عزل نظام الملفات"
          desc="ملفات كل مستخدم مخزنة في مجلد منفصل لا يمكن الوصول إليه إلا من قبله. النظام يفرض التحقق الصارم من المسار في كل عملية ملف."
          items={[
            { label: "مجلد شخصي لكل مستخدم", desc: "كل مستخدم يحصل على مجلد منزلي خاص في /home/runner/ بمشاريعه وتكويناته وبياناته. لا يمكن لأي مستخدم التาะّل خارج مجلده." },
            { label: "حماية من تجاوز المسارات", desc: "كل عملية ملف (قراءة، كتابة، حذف، إعادة تسمية) تتحقق أن المسار المحسوب يبقى داخل مجلد سندبود المستخدم. هجمات Symlink محظورة." },
            { label: "عزل الرفع", desc: "الملفات المرفوعة تُكتب مباشرة إلى مجلد سندبود المستخدم. لا يوجد منطقة رفع مشتركة بين المستخدمين." },
            { label: "لا وصول بين المستخدمين", desc: "نقاط النهاية تتطلب JWT authentication وتحلل المسارات دائماً بالنسبة لمجلد سندبود المستخدم المصادق عليه. لا يوجد طريقة للوصول لملفات مستخدم آخر." },
          ]}
        />

        {/* Layer 3 */}
        <SecurityLayer
          icon={TerminalSquare}
          color="#f59e0b"
          title="الطبقة الثالثة: سندبود الطرفية"
          desc="الطرفية التفاعلية تفرض قيود أمان إضافية فوق عزل الحاوية."
          items={[
            { label: "الأوامر المحظورة", desc: "sudo و su و docker و systemctl و mount و fdisk و mkfs و dd و passwd و iptables و crontab وأوامر نظام أخرى محظورة." },
            { label: "تقييد cd", desc: "أوامر cd مقيّدة بمجلد سندبود المستخدم فقط. لا يمكن الانتقال إلى /etc أو /root أو أي مجلد نظام آخر." },
            { label: "حماية rm", desc: "rm -rf و rm -f محظوران. المستخدمون لا يمكنهم حذف الملفات إلا بشكل فردي مع تأكيد آمن." },
            { label: "حدود الموارد", desc: "وقت المعالج: 300 ثانية، حجم الملف: 100MB، الملفات المفتوحة: 2048، الحد الأقصى للعمليات: 200. يمنع استنزاف الموارد." },
          ]}
        />

        {/* Layer 4 */}
        <SecurityLayer
          icon={Lock}
          color="#ef4444"
          title="الطبقة الرابعة: سندبود تشغيل الشفرة"
          desc="عند تشغيل أي شفرة (Python, Node.js, PHP, Bash) عبر المنصة، تُنفذ داخل سندبود مع حماية إضافية حسب اللغة."
          items={[
            { label: "Python — Audit Hooks", desc: "sys.addaudithook يعترض جميع عمليات الملفات (open, remove, mkdir, rename, chmod...) ويحظر الوصول خارج مجلد المستخدم. لا يمكن إزالة هذا الـ hook بعد تسجيله." },
            { label: "Python — Builtins Guard", desc: "دالة builtins.open معدلة للتحقق من المسارات قبل الفتح. حتى لو حاول كود المستخدم استدعاء open() مباشرة، سيُحظر إذا كان المسار خارج السندبود." },
            { label: "Node.js — VM Context", desc: "الشفرة تعمل داخل vm.Context معزول. الوحدات الخطيرة (child_process, net, http, fs) محظورة أو محصّنة. كل عمليات fs تُفحص قبل التنفيذ." },
            { label: "PHP — open_basedir + disable_functions", desc: "PHP يُقيد بالـ open_basedir لمجلد المستخدم فقط. الدوال الخطيرة (exec, system, shell_exec, passthru...) معطلة..Classes الخطيرة محظورة." },
            { label: "Bash — PATH مقيّد + أوامر محظورة", desc: "مسار PATH محدود فقط للمجلدات النظام ومجلد المستخدم. أوامر النظام (sudo, docker, mount...) محظورة. كل أوامر الملفات تُفحص." },
            { label: "كل اللغات — فشل مقفل", desc: "في كل اللغات، إذا فشل أي فحص أمان أو حدث خطأ غير متوقع، الوصول يُرفض افتراضياً. لا يوجد مسار فتح عند الفشل." },
          ]}
        />

        {/* Layer 5 */}
        <SecurityLayer
          icon={Eye}
          color="#06b6d4"
          title="الطبقة الخامسة: أمان الشبكة والـ API"
          desc="جميع اتصالات الـ API محمية بالمصادقة وتقييد المعدل."
          items={[
            { label: "مصادقة JWT", desc: "كل طلب API يتطلب رمز JWT صالح. الرموز تُتحقق في كل طلب. انتهاء الصلاحية بعد فترة محددة." },
            { label: "تقييد المعدل", desc: "نقاط النهاية محمية بتقييد المعدل لمنع سوء الاستخدام وهجمات القوة الغاشمة." },
            { label: "HTTPS في الإنتاج", desc: "جميع الاتصالات مشفرة عبر TLS في بيئة الإنتاج. Render يوفر شهادات SSL تلقائية." },
            { label: "حماية CORS", desc: "طلبات Cross-origin مقيّدة. فقط نطاق المنصة نفسه يمكنه عمل طلبات API." },
          ]}
        />

        {/* Summary */}
        <div className="rounded-xl border p-4" style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.03)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4 text-green-400" />
            <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider">5 طبقات حماية مستقلة</h3>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            بياناتك محمية بـ <span className="text-green-400 font-semibold">5 طبقات أمان مستقلة</span>: عزل الحاوية،
            عزل نظام الملفات، سندبود الطرفية، سندبود تشغيل الشفرة، وأمان الشبكة والـ API.
            حتى لو تمت اختراق طبقة واحدة، الطبقات المتبقية تستمر في حماية بياناتك.
            نهج الدفاع المتعدد هذا يضمن بقاء ملفاتك وشفرتك وعملياتك خاصة وآمنة.
          </p>
        </div>
      </div>
    </div>
  );
}

