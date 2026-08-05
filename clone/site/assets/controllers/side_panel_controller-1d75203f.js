import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["panel"]

  connect() {
    console.log("Side panel controller connected")
    this.setupTurboFrameListeners()
    this.setupNavigationListeners()
  }

  disconnect() {
    console.log("Side panel controller disconnected")
    // イベントリスナーのクリーンアップ
    document.removeEventListener("turbo:frame-load", this.handleFrameLoad.bind(this))
    document.removeEventListener("turbo:frame-missing", this.handleFrameMissing.bind(this))
    document.removeEventListener("turbo:before-visit", this.handleBeforeVisit.bind(this))
    document.removeEventListener("turbo:visit", this.handleVisit.bind(this))
  }

  setupTurboFrameListeners() {
    // Turbo Frameがロードされたときにパネルを表示
    document.addEventListener("turbo:frame-load", this.handleFrameLoad.bind(this))
    document.addEventListener("turbo:frame-missing", this.handleFrameMissing.bind(this))
  }

  setupNavigationListeners() {
    // ページ遷移時の処理
    document.addEventListener("turbo:before-visit", this.handleBeforeVisit.bind(this))
    document.addEventListener("turbo:visit", this.handleVisit.bind(this))
  }

  handleBeforeVisit(event) {
    // ページ遷移前にサイドパネルを非表示にする
    console.log("Before visit - hiding side panel")
    this.hidePanel()
  }

  handleVisit(event) {
    // ページ遷移時の処理
    console.log("Page visit detected")
    // サイドパネルが表示されている場合は非表示にする
    const panel = this.element.querySelector("#side_panel")
    if (panel && !panel.classList.contains("translate-x-full")) {
      this.hidePanel()
    }
  }

  handleFrameLoad(event) {
    if (event.target.id === "side_panel") {
      console.log("Side panel frame loaded")
      this.showPanel()
    }
  }

  handleFrameMissing(event) {
    if (event.target.id === "side_panel") {
      console.log("Side panel frame missing")
      this.hidePanel()
    }
  }

  showPanel() {
    console.log("Showing side panel")
    const panel = this.element.querySelector("#side_panel")
    
    if (panel) {
      // パネルを表示
      panel.classList.remove("translate-x-full")
      panel.classList.add("translate-x-0")
    }
  }

  hidePanel() {
    console.log("Hiding side panel")
    const panel = this.element.querySelector("#side_panel")
    
    if (panel) {
      // パネルを非表示
      panel.classList.remove("translate-x-0")
      panel.classList.add("translate-x-full")
      
      // パネルの内容をクリア
      setTimeout(() => {
        if (panel) {
          panel.innerHTML = ""
          // src属性もクリアしてキャッシュされた状態をリセット
          panel.removeAttribute('src')
        }
      }, 300) // アニメーション完了後にクリア
    }
  }

  close() {
    console.log("Close button clicked")
    this.hidePanel()
    
    // URLからID関連パラメータを削除（order_id / report_id）
    const url = new URL(window.location)
    url.searchParams.delete("order_id")
    url.searchParams.delete("report_id")
    window.history.pushState({}, "", url)
    
    // 注文行のハイライトを削除
    this.removeOrderHighlight()
  }
  
  removeOrderHighlight() {
    document.querySelectorAll('[id^="order_"], [id^="order_card_"]').forEach(element => {
      element.classList.remove('bg-blue-50', 'ring-2', 'ring-blue-500', 'ring-opacity-50')
    })
  }

  // 強制的にパネルをリセットするメソッド
  reset() {
    console.log("Resetting side panel")
    const panel = this.element.querySelector("#side_panel")
    
    if (panel) {
      panel.classList.remove("translate-x-0")
      panel.classList.add("translate-x-full")
      panel.innerHTML = ""
      panel.removeAttribute('src')
    }
  }

  // 削除前にパネルをリセット（削除確認後に呼ばれる）
  resetBeforeDelete(event) {
    // 削除確認ダイアログの処理
    const confirmMessage = event.currentTarget.dataset.confirmMessage

    // 対象フォームを取得（button_to が生成する form を想定）
    const form = event.currentTarget.closest('form')

    // 確認ダイアログ（キャンセルなら送信を止める）
    if (confirmMessage && !confirm(confirmMessage)) {
      event.preventDefault()
      return
    }

    // ここでパネルの内容を即時に消すと "form is not connected" になるため禁止
    // 送信開始時は見た目だけ閉じ、内容のクリアは送信完了後に行う
    if (form) {
      // 送信開始時にパネルを閉じる（DOMクリアはしない）
      form.addEventListener('turbo:submit-start', () => {
        this.hidePanel()
      }, { once: true })

      // 完了後に安全にリセット（DOMをクリア）
      form.addEventListener('turbo:submit-end', () => {
        this.reset()
      }, { once: true })
    }
    // デフォルトのフォーム送信は継続（preventDefault しない）
  }

  // パネルを閉じてからナビゲーションを行う
  closeAndNavigate(event) {
    event.preventDefault()
    console.log("Close and navigate clicked")
    
    // まずパネルを非表示にする
    this.hidePanel()
    
    // 少し遅らせてからナビゲーション
    setTimeout(() => {
      const href = event.currentTarget.href
      if (href) {
        window.location.href = href
      }
    }, 100)
  }
}
