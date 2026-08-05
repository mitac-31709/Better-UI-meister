import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["menu", "button"]

  connect() {
    // 外部クリックを監視するリスナーを追加
    this.boundHandleOutsideClick = this.handleOutsideClick.bind(this)
  }

  disconnect() {
    // リスナーをクリーンアップ
    document.removeEventListener("click", this.boundHandleOutsideClick)
  }

  toggle(event) {
    event.preventDefault()
    event.stopPropagation()
    
    if (this.menuTarget.classList.contains("hidden")) {
      this.open()
    } else {
      this.close()
    }
  }

  open() {
    this.menuTarget.classList.remove("hidden")
    this.buttonTarget.setAttribute("aria-expanded", "true")
    
    // 外部クリックリスナーを追加
    document.addEventListener("click", this.boundHandleOutsideClick)
  }

  close() {
    this.menuTarget.classList.add("hidden")
    this.buttonTarget.setAttribute("aria-expanded", "false")
    
    // 外部クリックリスナーを削除
    document.removeEventListener("click", this.boundHandleOutsideClick)
  }

  handleOutsideClick(event) {
    // ドロップダウンボタンやメニュー内をクリックした場合は何もしない
    if (this.element.contains(event.target)) {
      return
    }
    
    // 外部をクリックした場合はメニューを閉じる
    this.close()
  }

  // ESCキーでメニューを閉じる
  keydown(event) {
    if (event.key === "Escape") {
      this.close()
    }
  }
}
