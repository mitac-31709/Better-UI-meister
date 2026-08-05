import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["shopName"]
  static values = { initialSiteType: String }

  connect() {
    // ページ読み込み時に初期値を設定
    const salesSiteSelect = this.element.querySelector('select[name*="sales_site_type"]')
    if (salesSiteSelect) {
      // 初期値を即座に適用
      this.initializeShopName(salesSiteSelect)
    }
  }

  initializeShopName(selectElement) {
    // 選択された値があればそれを使用、なければデフォルト値
    const currentValue = selectElement.value || "amazon"
    this.updateShopNameField(currentValue)
  }

  updateShopName(event) {
    this.updateShopNameField(event.target.value)
  }

  updateShopNameField(selectedValue) {
    const shopNameMapping = {
      "amazon": "Amazon",
      "monotaro": "モノタロウ",
      "akizuki": "秋月電子通商",
      "other": ""
    }

    const shopName = shopNameMapping[selectedValue] || ""
    
    if (this.hasShopNameTarget) {
      this.shopNameTarget.value = shopName
      
      // 「その他」の場合は入力可能にする
      if (selectedValue === "other") {
        this.shopNameTarget.readOnly = false
        this.shopNameTarget.classList.remove("bg-gray-50")
        this.shopNameTarget.classList.add("bg-white")
        this.shopNameTarget.placeholder = "販売サイト名を入力してください"
      } else {
        this.shopNameTarget.readOnly = true
        this.shopNameTarget.classList.add("bg-gray-50")
        this.shopNameTarget.classList.remove("bg-white")
        this.shopNameTarget.placeholder = "販売サイトを選択すると自動入力されます"
      }
    }
  }
}