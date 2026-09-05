import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, useSpring, type Variants } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useDemo } from '@/contexts/DemoContext';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import { ArrowRight, BarChart3, Shield, Target, Wallet, Car, Crown, TrendingUp, Lock, Zap } from 'lucide-react';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.45 } }),
};

// ⚠️ COPY LIVES IN src/locales/<lang>/landing.json, NOT HERE. These rows carry the
// icon, the ordering and the catalogue key; every visible string is looked up at render.
// A key added here without an entry in BOTH locale files renders the key itself, which is
// why landing-i18n.test.ts asserts the two catalogues have identical shapes.
const features = [
  { icon: Wallet, key: 'cashFlow' },
  { icon: BarChart3, key: 'analytics' },
  { icon: Shield, key: 'debt' },
  { icon: Target, key: 'savings' },
  { icon: Car, key: 'carFund' },
  { icon: Crown, key: 'premium' },
];

// A symbol suffix (`+`, `%`) is not language. " ads" IS words, so that row carries a
// catalogue key instead and the symbol rows keep their literal.
const stats: { value: number; suffix?: string; suffixKey?: string; key: string }[] = [
  { value: 12, suffix: '+', key: 'tools' },
  { value: 100, suffix: '%', key: 'freeToStart' },
  { value: 0, suffixKey: 'adsSuffix', key: 'ever' },
];

const pillars = [
  { icon: TrendingUp, key: 'track' },
  { icon: Lock, key: 'secure' },
  { icon: Zap, key: 'automate' },
];


function AnimatedCounter({ target, suffix }: { target: number; suffix: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const observed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !observed.current) {
        observed.current = true;
        const duration = 1200;
        const start = performance.now();
        const animate = (now: number) => {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setCount(Math.round(eased * target));
          if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={ref}>{count}{suffix}</span>;
}

export default function Landing() {
  const { t } = useTranslation('landing');
  const { setIsDemo } = useDemo();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Referral capture used to live here, Landing-only and writing a key nothing read. It is now
  // `CaptureReferral` in `App.tsx`, which runs on every route — a shared link that points anywhere
  // other than the home page (`/auth?ref=…`, a deep link into a build) attributes just the same.
  // See `@/lib/referral`.
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 });

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(((e.clientX - rect.left) / rect.width - 0.5) * 20);
    mouseY.set(((e.clientY - rect.top) / rect.height - 0.5) * 20);
  };

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden bg-background" style={{ WebkitOverflowScrolling: 'touch' }}>
      {/* Nav */}
      <motion.header
  className="border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm"
  style={{ paddingTop: 'env(safe-area-inset-top)' }}
  initial={{ opacity: 0, y: -10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.35 }}
      >
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <motion.span
            className="font-display font-bold text-sm tracking-tight text-gold"
            whileHover={{ scale: 1.04 }}
          >
            FORGENTA
          </motion.span>
          <div className="flex items-center gap-4">
            {/* On the SIGNED-OUT page on purpose: a language preference that lives only
                behind sign-in is unreachable by the person who most needs it. */}
            <LanguageSwitcher className="bg-transparent border border-border px-2 py-1 text-foreground/70" />
            <Link to="/auth" className="text-xs text-foreground/70 hover:text-foreground transition-colors">
              {t('nav.signIn')}
            </Link>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/auth"
                className="text-xs font-medium bg-primary text-primary-foreground px-4 py-1.5 btn-press transition-colors hover:bg-primary/90"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {t('nav.startFree')}
              </Link>
            </motion.div>
          </div>
        </div>
      </motion.header>

      <main>
      {/* Hero */}
      <section
        className="max-w-6xl mx-auto px-4 pt-16 pb-24 lg:pt-24 lg:pb-36 text-center relative"
        onMouseMove={handleMouseMove}
      >
        {/* Ambient glow */}
        <motion.div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ x: springX, y: springY }}
        >
          <div className="w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl" />
        </motion.div>

        <motion.div
          className="inline-flex items-center gap-2 border border-primary/30 bg-primary/5 text-primary px-3 py-1 text-[10px] font-semibold tracking-wider uppercase mb-6"
          style={{ borderRadius: 'var(--radius)' }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Zap size={9} /> {t('hero.badge')}
        </motion.div>

        <motion.h1
          className="font-display font-extrabold text-4xl md:text-6xl lg:text-7xl tracking-tight text-foreground relative"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
        >
          {t('hero.titleLine1')}<br />
          <span className="text-gold">{t('hero.titleAccent')}</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          {t('hero.subtitle')}
        </motion.p>

        <motion.div
          className="mt-10 flex items-center justify-center gap-4 flex-wrap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <Link
              to="/auth"
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold btn-press transition-colors hover:bg-primary/90"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {t('hero.startFree')} <ArrowRight size={14} />
            </Link>
          </motion.div>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/dashboard"
              onClick={() => setIsDemo(true)}
              className="flex items-center gap-2 border border-border text-foreground px-6 py-2.5 text-sm font-semibold btn-press transition-colors hover:bg-accent"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {t('hero.seeDemo')}
            </Link>
          </motion.div>
        </motion.div>

        <motion.div
          className="mt-6 flex flex-col items-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 0.5 }}
        >
          <a
            href="https://apps.apple.com/us/app/forgenta-track-build-wealth/id6762540239"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('hero.appStoreAria')}
          >
            <img
              src="/app-store-badge.svg"
              alt={t('hero.appStoreAlt')}
              style={{ height: 54, width: 'auto' }}
            />
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.treforged.forged&pcampaignid=web_share"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('hero.playStoreAria')}
          >
            <img
              src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
              alt={t('hero.playStoreAlt')}
              style={{ height: 64, width: 'auto' }}
            />
          </a>
        </motion.div>
      </section>

      {/* Stats */}
      <section className="border-t border-b border-border py-12 bg-secondary/20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-3 gap-6 text-center">
            {stats.map((s, i) => (
              <motion.div
                key={s.key}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
              >
                <p className="font-display font-extrabold text-3xl md:text-4xl text-gold">
                  <AnimatedCounter target={s.value} suffix={s.suffixKey ? t('stats.' + s.suffixKey) : (s.suffix ?? '')} />
                </p>
                <p className="text-[10px] text-foreground/60 mt-1 uppercase tracking-wider">{t('stats.' + s.key)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="sr-only">{t('pillars.srHeading')}</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {pillars.map((p, i) => (
            <motion.div
              key={p.key}
              className="card-forged p-5 flex items-start gap-4 group hover:border-primary/30 transition-colors"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              whileHover={{ y: -2 }}
            >
              <div className="p-2 bg-primary/10 border border-primary/20 shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                <p.icon size={16} className="text-primary" />
              </div>
              <div>
                <h3 className="font-display font-bold text-sm mb-1 group-hover:text-primary transition-colors">{t('pillars.' + p.key + '.title')}</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{t('pillars.' + p.key + '.desc')}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-border">
        <motion.div
          className="text-center mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight mb-3">
            {t('features.heading')}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {t('features.subheading')}
          </p>
        </motion.div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.key}
              className="card-forged p-6 group hover:border-primary/25 transition-all duration-300 cursor-default"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
              whileHover={{ y: -3, transition: { duration: 0.2 } }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-1.5 bg-gold/10 border border-gold/20" style={{ borderRadius: 'var(--radius)' }}>
                  <f.icon size={15} className="text-gold" />
                </div>
                <h3 className="font-display font-semibold text-sm group-hover:text-primary transition-colors">{t('features.' + f.key + '.title')}</h3>
              </div>
              <p className="text-xs text-foreground/65 leading-relaxed">{t('features.' + f.key + '.desc')}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Founder Note */}
      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-border">
        <motion.div
          className="max-w-2xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <div className="card-forged p-8 md:p-10 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-gold/60" style={{ borderRadius: 'var(--radius) 0 0 var(--radius)' }} />
            <p className="text-[10px] font-bold text-gold uppercase tracking-widest mb-5 pl-4">{t('founder.label')}</p>
            <blockquote className="text-sm md:text-base text-foreground leading-relaxed pl-4">
              {t('founder.quote')}
            </blockquote>
            <div className="flex items-center gap-3 mt-6 pl-4">
              <div className="w-9 h-9 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center text-xs font-bold text-gold">T</div>
              <div>
                <p className="text-xs font-semibold text-foreground">{t('founder.name')}</p>
                <p className="text-[10px] text-muted-foreground">{t('founder.role')}</p>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="border-t border-border py-20 bg-secondary/10">
        <motion.div
          className="max-w-xl mx-auto px-4 text-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          custom={0}
        >
          <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight mb-4">
            {t('cta.heading')}
          </h2>
          <p className="text-sm text-muted-foreground mb-8">
            {t('cta.subheading')}
          </p>
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 text-sm font-semibold btn-press transition-colors hover:bg-primary/90"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {t('cta.button')} <ArrowRight size={14} />
            </Link>
          </motion.div>
        </motion.div>
      </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-display font-bold text-xs tracking-tight text-gold">FORGENTA</span>
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>{t('footer.rights', { year: new Date().getFullYear() })}</span>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors underline underline-offset-2">{t('footer.privacy')}</Link>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">{t('footer.terms')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
