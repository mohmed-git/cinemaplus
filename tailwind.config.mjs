/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Tajawal', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* brand scale — يُستخدم كاحتياطي ثابت؛ التلوين الديناميكي للأقسام
           يتم عبر متغيرات CSS في global.css (.theme-* / [data-section]). */
        brand: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
          950: '#083344',
        },
        surface: {
          0: '#04070a',
          1: '#070b10',
          2: '#0c1218',
          3: '#121a23',
          4: '#1a2330',
          5: '#243042',
          6: '#324259',
        },
        gold: {
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        accent: {
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
        },
        /* ألوان النيون المستخدمة عبر الصفحات (احتياطي) */
        neon: {
          cyan: '#22d3ee',
          teal: '#14b8a6',
          violet: '#8b5cf6',
          fuchsia: '#d946ef',
          amber: '#fbbf24',
          coral: '#fb7185',
          emerald: '#10b981',
          orange: '#f97316',
          crimson: '#b91c1c',
        },
      },
      boxShadow: {
        card: '0 10px 32px -10px rgba(0,0,0,.7)',
        'card-hover': '0 28px 64px -12px rgba(0,0,0,.85)',
        glass: '0 8px 32px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.06)',
      },
      backdropBlur: {
        xs: '2px',
      },
      backgroundImage: {
        'aurora':
          'radial-gradient(at 20% 0%, rgba(34,211,238,0.20) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(167,139,250,0.14) 0px, transparent 50%), radial-gradient(at 50% 100%, rgba(34,211,238,0.10) 0px, transparent 50%)',
      },
      animation: {
        'fade-in': 'fadeIn .5s ease-out both',
        'slide-up': 'slideUp .6s cubic-bezier(0.16,1,0.3,1) both',
        'slide-down': 'slideDown .35s ease-out both',
        'scale-in': 'scaleIn .4s cubic-bezier(0.34,1.56,0.64,1) both',
        'hero-slide': 'heroSlide 0.9s cubic-bezier(0.16,1,0.3,1) both',
        'pulse-glow': 'pulseGlow 2.4s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: {
          '0%': { opacity: 0, transform: 'translateY(24px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: 0, transform: 'translateY(-12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: 0, transform: 'scale(0.94)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        heroSlide: {
          '0%': { opacity: 0, transform: 'scale(1.06) translateY(8px)' },
          '100%': { opacity: 1, transform: 'scale(1) translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 16px rgba(34,211,238,.35)', transform: 'scale(1)' },
          '50%': { boxShadow: '0 0 40px rgba(34,211,238,.65)', transform: 'scale(1.02)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
      },
    },
  },
  plugins: [],
};
