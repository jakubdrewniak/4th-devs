export type Theme = 'light' | 'dark' | 'system'

class ThemeStore {
  theme = $state<Theme>('system')
  isDark = $state(false)

  constructor() {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme | null
      if (stored && ['light', 'dark', 'system'].includes(stored)) {
        this.theme = stored
      }

      this.updateIsDark()

      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.theme === 'system') {
          this.updateIsDark()
        }
      })
    }
  }

  setTheme(t: Theme) {
    this.theme = t
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', t)
      this.updateIsDark()
    }
  }

  private updateIsDark() {
    if (this.theme === 'system') {
      this.isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    } else {
      this.isDark = this.theme === 'dark'
    }

    if (this.isDark) {
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.style.colorScheme = 'light'
    }
  }
}

export const themeStore = new ThemeStore()
