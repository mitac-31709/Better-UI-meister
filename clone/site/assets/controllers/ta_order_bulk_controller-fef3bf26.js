import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["orderCheckbox", "selectAllCheckbox", "bulkActions", "inlineSelectedCount"]

  connect() {
    this.updateUI()
  }

  // 全選択/全解除の切り替え
  toggleSelectAll() {
    const isChecked = this.selectAllCheckboxTarget.checked
    const visibleCheckboxes = this.getVisibleCheckboxes()
    
    visibleCheckboxes.forEach(checkbox => {
      checkbox.checked = isChecked
    })
    this.updateUI()
  }

  // 個別チェックボックスの変更時
  updateSelection() {
    this.updateSelectAllState()
    this.updateUI()
  }

  // チェックボックスのクリック時に行クリックのイベントを停止
  stopPropagation(event) {
    event.stopPropagation()
  }

  // 全選択チェックボックスの状態を更新
  updateSelectAllState() {
    const visibleCheckboxes = this.getVisibleCheckboxes()
    const totalVisibleCheckboxes = visibleCheckboxes.length
    const checkedVisibleCheckboxes = this.getSelectedCheckboxes().length

    if (checkedVisibleCheckboxes === 0) {
      this.selectAllCheckboxTarget.checked = false
      this.selectAllCheckboxTarget.indeterminate = false
    } else if (checkedVisibleCheckboxes === totalVisibleCheckboxes) {
      this.selectAllCheckboxTarget.checked = true
      this.selectAllCheckboxTarget.indeterminate = false
    } else {
      this.selectAllCheckboxTarget.checked = false
      this.selectAllCheckboxTarget.indeterminate = true
    }
  }

  // 選択されたチェックボックスを取得（表示されているもののみ）
  getSelectedCheckboxes() {
    return this.orderCheckboxTargets.filter(checkbox => {
      return checkbox.checked && this.isCheckboxVisible(checkbox)
    })
  }

  // 表示されているチェックボックスを取得
  getVisibleCheckboxes() {
    return this.orderCheckboxTargets.filter(checkbox => {
      return this.isCheckboxVisible(checkbox)
    })
  }

  // チェックボックスが表示されているかを判定
  isCheckboxVisible(checkbox) {
    const row = checkbox.closest('tr')
    return row && !row.hidden && row.style.display !== 'none'
  }

  // UIの更新
  updateUI() {
    const selectedCount = this.getSelectedCheckboxes().length
    
    // 選択件数の表示を更新
    if (this.hasInlineSelectedCountTarget) {
      this.inlineSelectedCountTarget.textContent = selectedCount
    }

    this.updateSelectAllState()
  }

  // 一括状態変更
  bulkUpdateStatus(event) {
    const newStatus = event.currentTarget.dataset.status
    const selectedCheckboxes = this.getSelectedCheckboxes()
    const selectedIds = selectedCheckboxes.map(cb => cb.dataset.orderId)
    
    if (selectedIds.length === 0) {
      alert('状態を変更する注文を選択してください。')
      return
    }
    
    // TAは available のみ許可
    if (newStatus !== 'available') {
      alert('TAは注文済みから受け取り可能への変更のみ可能です。')
      return
    }
    
    const confirmMessage = `選択された${selectedIds.length}件の注文済み状態の注文を「受け取り可能」に変更します。\n（他の状態の注文は除外されます）\nよろしいですか？`
    
    if (!confirm(confirmMessage)) {
      return
    }
    
    // Turbo Stream 期待のFetch送信
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
    const formData = new FormData()
    selectedIds.forEach(id => formData.append('order_ids[]', id))
    formData.append('status', newStatus)
    formData.append('_method', 'PATCH')
    if (csrfToken) formData.append('authenticity_token', csrfToken)

    fetch('/ta/orders/bulk_update_status', {
      method: 'POST',
      headers: { 'Accept': 'text/vnd.turbo-stream.html' },
      body: formData
    })
      .then(resp => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.text()
      })
      .then(html => {
        Turbo.renderStreamMessage(html)
      })
      .catch(err => {
        alert(`一括更新中にエラーが発生しました: ${err.message}`)
      })

    // 送信後は一旦選択解除してUIを更新
    this.orderCheckboxTargets.forEach(cb => cb.checked = false)
    this.updateUI()
  }
}