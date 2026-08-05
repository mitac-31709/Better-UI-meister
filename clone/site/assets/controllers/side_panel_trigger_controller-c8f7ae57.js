import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { url: String }

  connect() {
    console.log("Side panel trigger controller connected")
  }

  open(event) {
    event.preventDefault()
    console.log("Opening side panel with URL:", this.urlValue)
    
    const sidePanelFrame = document.querySelector('#side_panel')
    if (sidePanelFrame) {
      // Turbo Frameにコンテンツをロード
      sidePanelFrame.setAttribute('src', this.urlValue)
      
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

  stopPropagation(event) {
    event.stopPropagation()
  }
}
