/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 행사 상태 색상
        'status-inq': '#9ca3af',   // 회색
        'status-ten': '#facc15',   // 노란색
        'status-def': '#22c55e',   // 초록색
        'status-los': '#ef4444',   // 빨간색
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Apple SD Gothic Neo"',
          '"Malgun Gothic"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
