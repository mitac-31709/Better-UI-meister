import { Controller } from "@hotwired/stimulus"

// 一般ユーザー用: 注文一覧で order_id クエリからサイドパネルを自動表示
export default class extends Controller {
  static values = { selectedOrderId: String }

  connect() {
    if (this.selectedOrderIdValue) {
      this.openSidebarForOrder(this.selectedOrderIdValue)
    }
  }

  openSidebarForOrder(orderId) {
    // サイドパネルを開く
    const detailsUrl = `/orders/${orderId}`
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
}
