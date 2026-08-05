import { Controller } from "@hotwired/stimulus"

// TA用: 週報一覧で report_id クエリからサイドパネルを自動表示
export default class extends Controller {
  static values = { selectedReportId: String }

  connect() {
    if (this.selectedReportIdValue) {
      this.openSidebarForReport(this.selectedReportIdValue)
    }
  }

  openSidebarForReport(reportId) {
    const detailsUrl = `/ta/reports/${reportId}`
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

    // 行ハイライト
    this.highlightReportRow(reportId)
  }

  highlightReportRow(reportId) {
    document.querySelectorAll('[id^="report_"]').forEach(el => {
      el.classList.remove('bg-blue-50', 'ring-2', 'ring-blue-500', 'ring-opacity-50')
    })

    const row = document.querySelector(`#report_${reportId}`)
    if (row) {
      row.classList.add('bg-blue-50', 'ring-2', 'ring-blue-500', 'ring-opacity-50')
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
}
