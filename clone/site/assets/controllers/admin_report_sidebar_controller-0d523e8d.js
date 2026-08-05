import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { selectedReportId: String }

  connect() {
    if (this.selectedReportIdValue) {
      this.openSidebarForReport(this.selectedReportIdValue)
    }
  }

  openSidebarForReport(reportId) {
    // ハイライト
    this.highlightReportRow(reportId)

    // サイドパネル内に詳細をロード
    const detailsUrl = `/admin/reports/${reportId}`
    const sidePanelFrame = document.querySelector('#side_panel')
    if (sidePanelFrame) {
      sidePanelFrame.setAttribute('src', detailsUrl)

      const sidePanelController = this.application.getControllerForElementAndIdentifier(
        document.querySelector('[data-controller*="side-panel"]'),
        'side-panel'
      )
      if (sidePanelController) {
        sidePanelController.showPanel()
      }
    }
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
