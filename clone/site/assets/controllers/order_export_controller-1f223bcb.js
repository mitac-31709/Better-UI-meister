import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["checkbox", "selectAllCheckbox", "exportButton", "selectedCount", "form", "bulkActions", "inlineSelectedCount"]
  static values = { exportUrl: String, bulkUpdateUrl: String }

  connect() {
    this.updateUI()
  }

  // 旧フィルタ関連ロジックは不要になったため削除

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
  checkboxChanged() {
    this.updateSelectAllState()
    this.updateUI()
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
    return this.checkboxTargets.filter(checkbox => {
      const row = checkbox.closest('tr')
      return checkbox.checked && row && row.style.display !== 'none' && !row.classList.contains('hidden')
    })
  }

  // 表示されているチェックボックスを取得
  getVisibleCheckboxes() {
    return this.checkboxTargets.filter(checkbox => {
      const row = checkbox.closest('tr')
      return row && row.style.display !== 'none' && !row.classList.contains('hidden')
    })
  }

  // 選択されたIDを取得
  getSelectedIds() {
    return this.getSelectedCheckboxes().map(checkbox => checkbox.value)
  }

  // UIの更新
  updateUI() {
    const selectedCount = this.getSelectedCheckboxes().length
    const hasSelection = selectedCount > 0

    // エクスポートボタンの有効/無効切り替え
    this.exportButtonTarget.disabled = !hasSelection
    if (hasSelection) {
      this.exportButtonTarget.classList.remove('opacity-50', 'cursor-not-allowed')
      this.exportButtonTarget.classList.add('hover:shadow-xl', 'hover:scale-105')
    } else {
      this.exportButtonTarget.classList.add('opacity-50', 'cursor-not-allowed')
      this.exportButtonTarget.classList.remove('hover:shadow-xl', 'hover:scale-105')
    }

    // 選択数の表示更新
    if (this.hasSelectedCountTarget) {
      this.selectedCountTarget.textContent = `${selectedCount}件選択中`
      this.selectedCountTarget.classList.toggle('hidden', selectedCount === 0)
    }
  }

  // エクスポート実行
  export() {
    const selectedIds = this.getSelectedIds()
    
    if (selectedIds.length === 0) {
      alert('エクスポートする注文を選択してください。')
      return
    }

    // 確認ダイアログ
    if (!confirm(`選択した${selectedIds.length}件の注文をエクスポートしますか？`)) {
      return
    }

    // フォームを作成してPOSTでエクスポート
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = this.exportUrlValue

    // CSRF token
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
    if (csrfToken) {
      const csrfInput = document.createElement('input')
      csrfInput.type = 'hidden'
      csrfInput.name = 'authenticity_token'
      csrfInput.value = csrfToken
      form.appendChild(csrfInput)
    }

    // 選択されたIDを追加
    selectedIds.forEach(id => {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'order_ids[]'
      input.value = id
      form.appendChild(input)
    })

    // フォームを送信
    document.body.appendChild(form)
    form.submit()
    document.body.removeChild(form)
  }

  // 一括状態変更実行
  bulkUpdateStatus(event) {
    const selectedIds = this.getSelectedIds()
    const newStatus = event.currentTarget.dataset.status
    
    if (selectedIds.length === 0) {
      alert('状態を変更する注文を選択してください。')
      return
    }
    
    if (!newStatus) return
    
    const statusNames = {
      'pending': '注文確認中',
      'ordered': '承認済み',
      'available': '受取可能',
      'received': '受取済み',
      'cancelled': 'キャンセル'
    }
    
  const confirmMessage = `選択された${selectedIds.length}件の注文を「${statusNames[newStatus]}」に変更します。\nよろしいですか？`
    
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

    fetch(this.bulkUpdateUrlValue, {
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
    this.checkboxTargets.forEach(cb => cb.checked = false)
    this.updateUI()
  }
}
