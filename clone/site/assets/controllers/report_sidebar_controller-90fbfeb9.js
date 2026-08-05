import { Controller } from "@hotwired/stimulus"

// Reports index: open side panel automatically when ?report_id= is present
export default class extends Controller {
  connect() {
    const params = new URLSearchParams(window.location.search)
    const reportId = params.get('report_id')
    if (!reportId) return

    // Wait until the side panel frame exists before trying to open it
    this.waitForSidePanel().then(() => {
      // Set a one-time listener in case the side-panel controller isn't ready yet
      const onFrameLoad = (event) => {
        if (event.target && event.target.id === 'side_panel') {
          // Fallback: ensure panel is visible even if side-panel controller missed the event
          this.forceOpenPanel()
          document.removeEventListener('turbo:frame-load', onFrameLoad)
        }
      }
      document.addEventListener('turbo:frame-load', onFrameLoad)

      // Intercept possible frame-missing to avoid full navigation and inject manually
      const onFrameMissing = (event) => {
        if (event.target && event.target.id === 'side_panel') {
          event.preventDefault()
          event.stopImmediatePropagation()
          this.forceOpenPanel()
          if (this._detailsUrl) {
            this.fetchAndInject(this._detailsUrl)
          }
          document.removeEventListener('turbo:frame-missing', onFrameMissing)
        }
      }
      document.addEventListener('turbo:frame-missing', onFrameMissing)

      this.openSidebarForReport(reportId)

      // Also try to show once the side-panel controller attaches
      this.waitForSidePanelController().then((controller) => {
        if (controller && typeof controller.showPanel === 'function') {
          controller.showPanel()
        } else {
          // As a last resort, force open visually
          this.forceOpenPanel()
        }
      })
    })
  }

  waitForSidePanel(maxRetries = 20, intervalMs = 50) {
    return new Promise((resolve) => {
      let attempts = 0
      const tryFind = () => {
        const frame = document.querySelector('#side_panel')
        if (frame) {
          resolve()
        } else if (attempts < maxRetries) {
          attempts += 1
          setTimeout(tryFind, intervalMs)
        } else {
          resolve() // give up but avoid blocking; openSidebar will no-op if not found
        }
      }
      // Defer first check to end of current frame to let DOM finish parsing
      requestAnimationFrame(tryFind)
    })
  }

  waitForSidePanelController(maxRetries = 20, intervalMs = 50) {
    return new Promise((resolve) => {
      let attempts = 0
      const tryFind = () => {
        const host = document.querySelector('[data-controller*="side-panel"]')
        if (host) {
          const controller = this.application.getControllerForElementAndIdentifier(host, 'side-panel')
          if (controller) {
            resolve(controller)
            return
          }
        }
        if (attempts < maxRetries) {
          attempts += 1
          setTimeout(tryFind, intervalMs)
        } else {
          resolve(null)
        }
      }
      tryFind()
    })
  }

  openSidebarForReport(reportId) {
    // Determine base path by namespace
    const path = window.location.pathname
    let detailsUrl
    if (path.startsWith('/admin')) {
      detailsUrl = `/admin/reports/${reportId}`
    } else if (path.startsWith('/ta')) {
      detailsUrl = `/ta/reports/${reportId}`
    } else {
      detailsUrl = `/reports/${reportId}`
    }

    this._detailsUrl = detailsUrl
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

  forceOpenPanel() {
    const panel = document.querySelector('#side_panel')
    if (!panel) return
    panel.classList.remove('translate-x-full')
    panel.classList.add('translate-x-0')
  }

  async fetchAndInject(url) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'text/html' } })
      const html = await res.text()
      const frame = document.querySelector('#side_panel')
      if (!frame) return

      // Try to extract inner of <turbo-frame id="side_panel">
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const inner = doc.querySelector('turbo-frame#side_panel')
      frame.innerHTML = inner ? inner.innerHTML : html
    } catch (e) {
      // noop
    }
  }
}
