import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { timeout: Number }

  connect() {
    this.hideTimeout = setTimeout(() => {
      this.hide()
    }, this.timeoutValue)
  }

  disconnect() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout)
    }
  }

  hide() {
    const flashDiv = this.element.querySelector('div')
    flashDiv.style.transform = 'translateX(100%)'
    
    setTimeout(() => {
      this.element.remove()
    }, 300)
  }
}
