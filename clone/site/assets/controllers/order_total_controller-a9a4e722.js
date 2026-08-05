import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["amount", "quantity", "total"]

  connect() {
    this.updateTotal()
  }

  updateTotal() {
    const amount = parseFloat(this.amountTarget.value) || 0
    const quantity = parseInt(this.quantityTarget.value) || 0
    const total = amount * quantity
    
    this.totalTarget.textContent = '¥' + total.toLocaleString('ja-JP')
  }
}
