import { Controller } from "@hotwired/stimulus"
import reportEditChannel from "channels/report_edit_channel"

export default class extends Controller {
  static targets = ["field"]
  static values = { 
    reportId: String,
    currentUserId: String,
    currentUserName: String,
    initialLocks: Array
  }

  connect() {
    this.lockedFields = new Set()
    this.fieldOwners = new Map()
    this.lockTimeouts = new Map()
    this.activeEditors = new Set()
    this.lastKnownContent = new Map() // 最後に知られている内容を保存
    this.conflictResolution = new Map() // 競合解決のための情報
    
    // デバッグログ
    console.log('CollaborativeEditController connected')
    console.log('Element:', this.element)
    console.log('All data attributes:', this.element.dataset)
    console.log('Report ID from value:', this.reportIdValue)
    console.log('Current User ID from value:', this.currentUserIdValue)
    console.log('Current User Name from value:', this.currentUserNameValue)
    
    // reportIdValueが存在しない場合はdata属性を直接確認
    const reportId = this.reportIdValue || this.element.dataset.collaborativeEditReportIdValue
    console.log('Final Report ID:', reportId)
    
    if (!reportId) {
      console.error('Report ID is missing!')
      console.log('Available data attributes:', Object.keys(this.element.dataset))
      return
    }
    
    // ActionCableに接続
    reportEditChannel.connect(reportId)
    
    // ブロードキャストイベントのリスナーを設定
    document.addEventListener('reportEditUpdate', this.handleBroadcast.bind(this))
    
    // フィールドイベントの設定
    this.fieldTargets.forEach(field => {
      this.setupFieldEvents(field)
      // 初期内容を保存
      this.lastKnownContent.set(field.dataset.fieldName, field.value)
    })

    // ページを離れる際のクリーンアップ
    window.addEventListener('beforeunload', this.cleanup.bind(this))
    
    // アクティブエディター表示の初期化
    this.updateActiveEditorsDisplay()
    
    // 初期ロック状態をロード
    this.loadInitialLocks()
  }

  loadInitialLocks() {
    if (this.initialLocksValue && this.initialLocksValue.length > 0) {
      this.initialLocksValue.forEach(lock => {
        this.handleFieldLocked({
          field_name: lock.field_name,
          user_id: lock.user_id,
          user_name: lock.user_name
        })
      })
    }
  }

  disconnect() {
    document.removeEventListener('reportEditUpdate', this.handleBroadcast.bind(this))
    window.removeEventListener('beforeunload', this.cleanup.bind(this))
    this.cleanup()
  }

  setupFieldEvents(field) {
    const fieldName = field.dataset.fieldName
    console.log('Setting up field events for:', fieldName, field)
    
    if (!fieldName) {
      console.warn('Field does not have data-field-name attribute:', field)
      return
    }
    
    // フォーカス時：ロック取得を試行
    field.addEventListener('focus', (e) => {
      console.log('Field focused:', fieldName)
      this.attemptLock(fieldName, field)
    })

    // ブラー時：ロック解除
    field.addEventListener('blur', (e) => {
      console.log('Field blurred:', fieldName)
      this.releaseLock(fieldName, field)
    })

    // 入力時：コンテンツ更新をブロードキャスト
    field.addEventListener('input', (e) => {
      console.log('Field input:', fieldName, field.value)
      if (this.hasLock(fieldName)) {
        // 最後に知られている内容を更新
        this.lastKnownContent.set(fieldName, field.value)
        this.debounceContentUpdate(fieldName, field.value)
      }
    })
  }

  attemptLock(fieldName, field) {
    if (this.lockedFields.has(fieldName) && !this.hasLock(fieldName)) {
      // 他のユーザーがロックしている場合
      this.showLockNotification(fieldName, field)
      field.blur()
      return
    }

    // ロック取得を試行
    if (reportEditChannel.subscription) {
      reportEditChannel.subscription.acquireLock(fieldName)
    }
  }

  releaseLock(fieldName, field) {
    if (this.hasLock(fieldName)) {
      if (reportEditChannel.subscription) {
        reportEditChannel.subscription.releaseLock(fieldName)
      }
      this.clearFieldLock(fieldName, field)
    }
  }

  hasLock(fieldName) {
    const owner = this.fieldOwners.get(fieldName)
    const currentUserId = this.currentUserIdValue || this.element.dataset.collaborativeEditCurrentUserIdValue
    return owner && owner.userId.toString() === currentUserId.toString()
  }

  debounceContentUpdate(fieldName, content) {
    // デバウンス処理でリアルタイム更新の頻度を制限
    const timeoutKey = `content_${fieldName}`
    
    if (this.lockTimeouts.has(timeoutKey)) {
      clearTimeout(this.lockTimeouts.get(timeoutKey))
    }

    const timeout = setTimeout(() => {
      if (reportEditChannel.subscription) {
        reportEditChannel.subscription.updateContent(fieldName, content)
      }
      // 自動保存も実行
      this.autoSave(fieldName, content)
      this.lockTimeouts.delete(timeoutKey)
    }, 300) // 300ms後に送信

    this.lockTimeouts.set(timeoutKey, timeout)
  }

  autoSave(fieldName, content) {
    const reportId = this.reportIdValue || this.element.dataset.collaborativeEditReportIdValue
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    
    fetch(`/reports/${reportId}/auto_save`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        field_name: fieldName,
        content: content
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.showAutoSaveIndicator('saved')
      } else {
        this.showAutoSaveIndicator('error', data.error)
      }
    })
    .catch(error => {
      console.error('Auto-save error:', error)
      this.showAutoSaveIndicator('error', 'Auto-save failed')
    })
  }

  showAutoSaveIndicator(status, message = null) {
    let indicator = document.querySelector('.auto-save-indicator')
    
    if (!indicator) {
      indicator = document.createElement('div')
      indicator.className = 'auto-save-indicator fixed bottom-4 right-4 px-3 py-2 rounded-md text-sm z-50'
      document.body.appendChild(indicator)
    }

    // スタイルを設定
    indicator.className = `auto-save-indicator fixed bottom-4 right-4 px-3 py-2 rounded-md text-sm z-50 ${
      status === 'saved' ? 'bg-green-500 text-white' : 
      status === 'saving' ? 'bg-blue-500 text-white' :
      'bg-red-500 text-white'
    }`
    
    indicator.textContent = message || (
      status === 'saved' ? '自動保存されました' :
      status === 'saving' ? '保存中...' :
      '保存エラー'
    )

    // 3秒後に隠す
    setTimeout(() => {
      if (indicator.parentElement) {
        indicator.remove()
      }
    }, 3000)
  }

  handleBroadcast(event) {
    const data = event.detail
    
    switch (data.action) {
      case 'field_locked':
        this.handleFieldLocked(data)
        break
      case 'field_unlocked':
        this.handleFieldUnlocked(data)
        break
      case 'content_updated':
        this.handleContentUpdated(data)
        break
    }
  }

  handleFieldLocked(data) {
    const { field_name, user_id, user_name } = data
    const field = this.findFieldByName(field_name)
    
    if (!field) return

    this.lockedFields.add(field_name)
    this.fieldOwners.set(field_name, { userId: user_id, userName: user_name })
    
    // アクティブエディターリストを更新
    this.activeEditors.add(`${user_id}:${user_name}`)
    this.updateActiveEditorsDisplay()

    const currentUserId = this.currentUserIdValue || this.element.dataset.collaborativeEditCurrentUserIdValue
    if (user_id.toString() !== currentUserId.toString()) {
      this.showFieldAsLocked(field_name, field, user_name)
    } else {
      this.showFieldAsOwned(field_name, field)
    }
  }

  handleFieldUnlocked(data) {
    const { field_name, user_id } = data
    const field = this.findFieldByName(field_name)
    
    if (!field) return

    this.clearFieldLock(field_name, field)
    
    // そのユーザーが他にロックしているフィールドがあるかチェック
    const hasOtherLocks = Array.from(this.fieldOwners.values()).some(owner => owner.userId === user_id)
    if (!hasOtherLocks) {
      // このユーザーをアクティブエディターリストから削除
      this.activeEditors.forEach(editor => {
        if (editor.startsWith(`${user_id}:`)) {
          this.activeEditors.delete(editor)
        }
      })
      this.updateActiveEditorsDisplay()
    }
  }

  updateActiveEditorsDisplay() {
    const container = document.getElementById('active-editors')
    if (!container) return

    const currentUserId = this.currentUserIdValue || this.element.dataset.collaborativeEditCurrentUserIdValue
    const editors = Array.from(this.activeEditors).map(editor => {
      const [userId, userName] = editor.split(':')
      return userId === currentUserId.toString() ? 
        `<span class="font-medium text-green-600">${userName} (あなた)</span>` : 
        `<span class="text-blue-600">${userName}</span>`
    })

    if (editors.length > 0) {
      container.innerHTML = `
        <div class="flex items-center space-x-2">
          <span class="text-gray-500">編集中:</span>
          <div class="flex space-x-2">${editors.join(', ')}</div>
        </div>
      `
    } else {
      container.innerHTML = ''
    }
  }

  handleContentUpdated(data) {
    const { field_name, content, user_id, user_name } = data
    const field = this.findFieldByName(field_name)
    
    const currentUserId = this.currentUserIdValue || this.element.dataset.collaborativeEditCurrentUserIdValue
    if (!field || user_id.toString() === currentUserId.toString()) return

    // 現在のフィールドが編集中（フォーカスされている）場合は、慎重に更新
    if (document.activeElement === field) {
      // カーソル位置を保存
      const cursorPosition = this.getCursorPosition(field)
      const oldContent = field.value
      
      // 編集中の場合は、短い通知のみ表示
      this.showEditingNotification(field_name, user_name)
      
      // オプション: 一定時間編集がない場合のみ内容を更新
      this.scheduleContentSync(field_name, field, content, cursorPosition)
    } else {
      // フィールドが編集中でない場合は、直接内容を更新
      this.updateFieldContent(field, content, user_name)
    }
  }

  getCursorPosition(field) {
    if (field.selectionStart !== undefined) {
      return {
        start: field.selectionStart,
        end: field.selectionEnd
      }
    }
    return null
  }

  setCursorPosition(field, position) {
    if (position && field.setSelectionRange) {
      // カーソル位置を調整（内容が変わった場合）
      const maxLength = field.value.length
      const start = Math.min(position.start, maxLength)
      const end = Math.min(position.end, maxLength)
      
      field.setSelectionRange(start, end)
    }
  }

  updateFieldContent(field, content, userName) {
    const fieldName = field.dataset.fieldName
    const currentContent = field.value
    const lastKnownContent = this.lastKnownContent.get(fieldName) || ''
    
    // 競合検出：現在の内容が最後に知られている内容と異なり、
    // かつフィールドが編集中の場合
    if (currentContent !== lastKnownContent && document.activeElement === field) {
      console.log('Conflict detected for field:', fieldName)
      this.handleContentConflict(field, currentContent, content, userName)
      return
    }
    
    // フィールドの内容を更新
    field.value = content
    this.lastKnownContent.set(fieldName, content)
    
    // 視覚的フィードバック：他のユーザーによる更新を示す
    field.classList.add('field-updated-by-other')
    
    // 短時間だけ更新者の名前を表示
    this.showUpdateIndicator(field, `${userName}により更新`, 'other-user-update')
    
    // アニメーション後にクラスを削除
    setTimeout(() => {
      field.classList.remove('field-updated-by-other')
    }, 1000)
  }

  handleContentConflict(field, localContent, remoteContent, userName) {
    const fieldName = field.dataset.fieldName
    
    // 競合解決のダイアログを表示
    this.showConflictResolutionDialog(field, localContent, remoteContent, userName)
  }

  showConflictResolutionDialog(field, localContent, remoteContent, userName) {
    // 既存のダイアログを削除
    const existingDialog = document.querySelector('.conflict-dialog')
    if (existingDialog) {
      existingDialog.remove()
    }

    const dialog = document.createElement('div')
    dialog.className = 'conflict-dialog fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'
    
    dialog.innerHTML = `
      <div class="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
        <h3 class="text-lg font-bold mb-4 text-red-600">編集の競合が発生しました</h3>
        <p class="mb-4 text-gray-600">${userName}さんも同じ項目を編集しています。どちらの内容を使用しますか？</p>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <h4 class="font-medium mb-2 text-green-600">あなたの編集内容:</h4>
            <textarea class="w-full p-3 border rounded-md resize-none" rows="4" readonly>${this.escapeHtml(localContent)}</textarea>
          </div>
          <div>
            <h4 class="font-medium mb-2 text-blue-600">${userName}さんの編集内容:</h4>
            <textarea class="w-full p-3 border rounded-md resize-none" rows="4" readonly>${this.escapeHtml(remoteContent)}</textarea>
          </div>
        </div>
        
        <div class="flex justify-end space-x-3">
          <button class="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600" data-choice="local">
            自分の内容を使用
          </button>
          <button class="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600" data-choice="remote">
            ${userName}さんの内容を使用
          </button>
          <button class="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600" data-choice="merge">
            手動で統合
          </button>
        </div>
      </div>
    `

    // イベントリスナーを追加
    dialog.addEventListener('click', (e) => {
      const choice = e.target.dataset.choice
      if (choice) {
        this.resolveConflict(field, localContent, remoteContent, choice)
        dialog.remove()
      }
    })

    document.body.appendChild(dialog)
  }

  resolveConflict(field, localContent, remoteContent, choice) {
    const fieldName = field.dataset.fieldName
    
    switch (choice) {
      case 'local':
        // 自分の内容を保持
        this.lastKnownContent.set(fieldName, localContent)
        // 他のユーザーに自分の内容を送信
        if (this.hasLock(fieldName)) {
          this.debounceContentUpdate(fieldName, localContent)
        }
        break
        
      case 'remote':
        // 相手の内容を採用
        field.value = remoteContent
        this.lastKnownContent.set(fieldName, remoteContent)
        break
        
      case 'merge':
        // 手動統合モードに入る
        this.enterMergeMode(field, localContent, remoteContent)
        break
    }
  }

  enterMergeMode(field, localContent, remoteContent) {
    // 統合用のテキストエリアを表示
    const mergeDialog = document.createElement('div')
    mergeDialog.className = 'conflict-dialog fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'
    
    mergeDialog.innerHTML = `
      <div class="bg-white rounded-lg p-6 max-w-4xl w-full mx-4">
        <h3 class="text-lg font-bold mb-4">内容を統合してください</h3>
        <textarea class="w-full p-3 border rounded-md" rows="8" placeholder="統合された内容をここに入力してください...">${this.escapeHtml(localContent)}</textarea>
        <div class="flex justify-end space-x-3 mt-4">
          <button class="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600" data-action="cancel">
            キャンセル
          </button>
          <button class="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600" data-action="save">
            統合内容を保存
          </button>
        </div>
      </div>
    `

    const textarea = mergeDialog.querySelector('textarea')
    const fieldName = field.dataset.fieldName

    mergeDialog.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'save') {
        const mergedContent = textarea.value
        field.value = mergedContent
        this.lastKnownContent.set(fieldName, mergedContent)
        
        // 統合内容を他のユーザーに送信
        if (this.hasLock(fieldName)) {
          this.debounceContentUpdate(fieldName, mergedContent)
        }
        
        mergeDialog.remove()
      } else if (e.target.dataset.action === 'cancel') {
        mergeDialog.remove()
      }
    })

    document.body.appendChild(mergeDialog)
    textarea.focus()
  }

  scheduleContentSync(fieldName, field, content, cursorPosition) {
    // 既存の同期タイマーをクリア
    const syncKey = `sync_${fieldName}`
    if (this.lockTimeouts.has(syncKey)) {
      clearTimeout(this.lockTimeouts.get(syncKey))
    }

    // 2秒後に同期（ユーザーが編集を停止した場合）
    const syncTimeout = setTimeout(() => {
      if (document.activeElement !== field) {
        // フィールドがもうフォーカスされていない場合は更新
        this.updateFieldContent(field, content, '他のユーザー')
      }
      this.lockTimeouts.delete(syncKey)
    }, 2000)

    this.lockTimeouts.set(syncKey, syncTimeout)
  }

  showEditingNotification(fieldName, userName) {
    const field = this.findFieldByName(fieldName)
    if (!field) return

    // 既存の通知を削除
    const existingNotification = field.parentElement.querySelector('.editing-notification')
    if (existingNotification) {
      existingNotification.remove()
    }

    // 小さな通知を表示
    const notification = document.createElement('div')
    notification.className = 'editing-notification absolute top-0 left-0 px-2 py-1 text-xs bg-blue-500 text-white rounded-br-md z-20 opacity-75'
    notification.textContent = `${userName}が編集中...`

    const container = field.closest('.relative') || field.parentElement
    container.style.position = 'relative'
    container.appendChild(notification)

    // 3秒後に自動削除
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove()
      }
    }, 3000)
  }

  showUpdateIndicator(field, message, type) {
    const indicator = document.createElement('div')
    indicator.className = `absolute top-0 right-0 px-2 py-1 text-xs rounded-bl-md z-20 ${
      type === 'other-user-update' ? 'bg-purple-500 text-white' : 'bg-blue-500 text-white'
    }`
    indicator.textContent = message

    const container = field.closest('.relative') || field.parentElement
    container.style.position = 'relative'
    
    // 既存のインジケーターを削除
    const existingIndicator = container.querySelector('.update-indicator')
    if (existingIndicator) {
      existingIndicator.remove()
    }
    
    indicator.classList.add('update-indicator')
    container.appendChild(indicator)

    // 2秒後にインジケーターを削除
    setTimeout(() => {
      if (indicator.parentElement) {
        indicator.remove()
      }
    }, 2000)
  }

  findFieldByName(fieldName) {
    return this.fieldTargets.find(field => 
      field.dataset.fieldName === fieldName
    )
  }

  showFieldAsLocked(fieldName, field, userName) {
    field.disabled = true
    field.classList.add('border-red-300', 'bg-red-50')
    
    this.showLockIndicator(field, `${userName}が編集中...`, 'editing')
  }

  showFieldAsOwned(fieldName, field) {
    field.classList.add('border-green-300', 'bg-green-50')
    this.showLockIndicator(field, 'あなたが編集中', 'owned')
  }

  clearFieldLock(fieldName, field) {
    this.lockedFields.delete(fieldName)
    this.fieldOwners.delete(fieldName)
    
    field.disabled = false
    field.classList.remove('border-red-300', 'bg-red-50', 'border-green-300', 'bg-green-50')
    
    this.hideLockIndicator(field)
  }

  showLockIndicator(field, message, type) {
    this.hideLockIndicator(field)
    
    const indicator = document.createElement('div')
    indicator.className = `absolute top-0 right-0 px-2 py-1 text-xs rounded-bl-md ${
      type === 'editing' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
    }`
    indicator.textContent = message
    indicator.setAttribute('data-lock-indicator', '')
    
    const container = field.closest('.relative') || field.parentElement
    container.style.position = 'relative'
    container.appendChild(indicator)
  }

  hideLockIndicator(field) {
    const container = field.closest('.relative') || field.parentElement
    const indicator = container.querySelector('[data-lock-indicator]')
    if (indicator) {
      indicator.remove()
    }
  }

  showContentPreview(fieldName, field, content, userName) {
    // プレビュー用の要素を作成/更新
    let preview = field.parentElement.querySelector('.content-preview')
    
    if (!preview) {
      preview = document.createElement('div')
      preview.className = 'content-preview absolute top-full left-0 right-0 bg-blue-50 border border-blue-200 p-2 text-sm text-blue-800 rounded-b-md z-10'
      field.parentElement.style.position = 'relative'
      field.parentElement.appendChild(preview)
    }

    preview.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="font-medium">${userName}:</span>
        <span class="flex-1 truncate">${this.escapeHtml(content)}</span>
      </div>
    `

    // 3秒後にプレビューを隠す
    setTimeout(() => {
      if (preview.parentElement) {
        preview.remove()
      }
    }, 3000)
  }

  showLockNotification(fieldName, field) {
    const owner = this.fieldOwners.get(fieldName)
    if (owner) {
      const notification = document.createElement('div')
      notification.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-md z-50'
      notification.textContent = `この項目は${owner.userName}が編集中です`
      
      document.body.appendChild(notification)
      
      setTimeout(() => {
        notification.remove()
      }, 3000)
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  cleanup() {
    const currentUserId = this.currentUserIdValue || this.element.dataset.collaborativeEditCurrentUserIdValue
    
    // 全てのロックを解除
    this.fieldOwners.forEach((owner, fieldName) => {
      if (owner.userId.toString() === currentUserId.toString()) {
        this.releaseLock(fieldName, this.findFieldByName(fieldName))
      }
    })

    // タイムアウトをクリア
    this.lockTimeouts.forEach(timeout => clearTimeout(timeout))
    this.lockTimeouts.clear()

    // ActionCable接続を切断
    reportEditChannel.disconnect()
  }
}
