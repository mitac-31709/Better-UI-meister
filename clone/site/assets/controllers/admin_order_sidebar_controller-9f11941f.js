import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { selectedOrderId: String }

  connect() {
    console.log("Admin order sidebar controller connected")
    console.log("Selected order ID:", this.selectedOrderIdValue)
    
    if (this.selectedOrderIdValue) {
      this.openSidebarForOrder(this.selectedOrderIdValue)
    }
  }

  openSidebarForOrder(orderId) {
    console.log("Opening sidebar for order:", orderId)
    
    // 該当する注文行をハイライト
    this.highlightOrderRow(orderId)
    
    // サイドパネルを開く
    const detailsUrl = `/admin/orders/${orderId}/details`
    const sidePanelFrame = document.querySelector('#side_panel')
    
    if (sidePanelFrame) {
      // Turbo Frameにコンテンツをロード
      sidePanelFrame.setAttribute('src', detailsUrl)
      
      // サイドパネルコントローラーのshowPanelメソッドを呼び出し
      const sidePanelController = this.application.getControllerForElementAndIdentifier(
        document.querySelector('[data-controller*="side-panel"]'), 
        'side-panel'
      )
      if (sidePanelController) {
        sidePanelController.showPanel()
      }
    }
  }

  highlightOrderRow(orderId) {
    // 全ての注文行・カードのハイライトを削除
    document.querySelectorAll('[id^="order_"], [id^="order_card_"]').forEach(element => {
      element.classList.remove('bg-blue-50', 'ring-2', 'ring-blue-500', 'ring-opacity-50')
    })
    
    // 該当する注文行をハイライト（デスクトップ）
    const orderRow = document.querySelector(`#order_${orderId}`)
    if (orderRow) {
      orderRow.classList.add('bg-blue-50', 'ring-2', 'ring-blue-500', 'ring-opacity-50')
      
      // 注文行をビューポートに表示（スムーズスクロール）
      orderRow.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      })
    }
    
    // 該当する注文カードをハイライト（モバイル）
    const orderCard = document.querySelector(`#order_card_${orderId}`)
    if (orderCard) {
      orderCard.classList.add('bg-blue-50', 'ring-2', 'ring-blue-500', 'ring-opacity-50')
      
      // 注文カードをビューポートに表示（スムーズスクロール）
      orderCard.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      })
    }
  }

  // クリックイベントでハイライトを更新し、サイドパネルを開く
  updateHighlight(event) {
    // リンク要素をクリックした場合は、デフォルトの動作を維持
    if (event.target.tagName === 'A' || event.target.closest('a')) {
      return
    }
    
    // チェックボックスクリックの場合は処理しない
    if (event.target.type === 'checkbox' || event.target.closest('input[type="checkbox"]')) {
      return
    }
    
    const element = event.currentTarget
    let orderId
    
    // 注文行の場合
    if (element.id.startsWith('order_')) {
      orderId = element.id.replace('order_', '')
    }
    // モバイルカードの場合
    else if (element.id.startsWith('order_card_')) {
      orderId = element.id.replace('order_card_', '')
    }
    // data-order-id属性から取得する場合
    else if (element.dataset.orderId) {
      orderId = element.dataset.orderId
    }
    
    if (!orderId) return
    
    // ハイライトを更新
    this.highlightOrderRow(orderId)
    
    // サイドパネルを開く
    this.openSidebarForOrder(orderId)
    
    // URLにorder_idパラメータを追加
    const url = new URL(window.location)
    url.searchParams.set('order_id', orderId)
    window.history.pushState({}, '', url)
  }
}