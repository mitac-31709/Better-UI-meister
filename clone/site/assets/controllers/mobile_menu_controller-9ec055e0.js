import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="mobile-menu"
export default class extends Controller {
  static targets = ["menu", "menuIcon", "closeIcon", "button", "desktopNav", "userName", "userBadge", "menuTitle"]
  static values = { breakpoint: Number }

  connect() {
    // デフォルトのブレークポイントを1000pxに設定
    if (!this.hasBreakpointValue) {
      this.breakpointValue = 1000
    }
    
    this.handleResize = this.handleResize.bind(this)
    window.addEventListener('resize', this.handleResize)
    this.handleResize() // 初期状態を設定
  }

  disconnect() {
    window.removeEventListener('resize', this.handleResize)
  }

  toggle() {
    this.menuTarget.classList.toggle('hidden')
    this.menuIconTarget.classList.toggle('hidden')
    this.closeIconTarget.classList.toggle('hidden')
  }

  close() {
    // モバイルメニューを閉じる
    if (!this.menuTarget.classList.contains('hidden')) {
      this.toggle()
    }
  }

  // メニューリンクがクリックされたときに呼ばれる
  linkClicked() {
    this.close()
  }

  handleResize() {
    const isDesktop = window.innerWidth >= this.breakpointValue

    // ハンバーガーメニューボタンの表示制御
    if (this.hasButtonTarget) {
      this.buttonTarget.style.display = isDesktop ? 'none' : 'block'
    }

    // デスクトップナビゲーションの表示制御
    if (this.hasDesktopNavTarget) {
      this.desktopNavTarget.style.display = isDesktop ? 'flex' : 'none'
    }

    // ユーザー名の表示制御
    if (this.hasUserNameTarget) {
      this.userNameTarget.style.display = isDesktop ? 'inline' : 'none'
    }

    // ユーザーバッジの表示制御（モバイルのみ）
    if (this.hasUserBadgeTarget) {
      this.userBadgeTarget.style.display = isDesktop ? 'none' : 'inline'
    }

    // モバイルメニュータイトルの表示制御
    if (this.hasMenuTitleTarget) {
      this.menuTitleTarget.style.display = isDesktop ? 'none' : 'block'
    }

    // デスクトップサイズでモバイルメニューが開いている場合は閉じる
    if (isDesktop && !this.menuTarget.classList.contains('hidden')) {
      this.menuTarget.classList.add('hidden')
      this.menuIconTarget.classList.remove('hidden')
      this.closeIconTarget.classList.add('hidden')
    }
  }
}
