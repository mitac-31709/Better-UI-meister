import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["item", "unreadCount"]

  // 個別の通知を既読にマーク
  async markAsRead(event) {
    event.preventDefault()
    const notificationItem = event.target.closest('[data-notification-id]')
    const notificationId = notificationItem?.dataset.notificationId
    
    if (!notificationId) return
    
    try {
      const response = await fetch(`/notifications/${notificationId}/mark_as_read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.getCSRFToken(),
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/vnd.turbo-stream.html'
        }
      })
      
      if (response.ok) {
        // Turbo Streamを処理
        const responseText = await response.text()
        Turbo.renderStreamMessage(responseText)
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }

  // 通知を削除
  async deleteNotification(event) {
    event.preventDefault()
    
    if (!confirm('この通知を削除しますか？')) return
    
    const notificationItem = event.target.closest('[data-notification-id]')
    const notificationId = notificationItem?.dataset.notificationId
    
    if (!notificationId) return
    
    try {
      const response = await fetch(`/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': this.getCSRFToken(),
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/vnd.turbo-stream.html'
        }
      })
      
      if (response.ok) {
        // Turbo Streamを処理
        const responseText = await response.text()
        Turbo.renderStreamMessage(responseText)
      }
    } catch (error) {
      console.error('Failed to delete notification:', error)
    }
  }

  // すべて既読にマーク
  async markAllAsRead(event) {
    event.preventDefault()
    
    if (!confirm('すべての通知を既読にしますか？')) return
    
    try {
      const response = await fetch('/notifications/mark_all_as_read', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.getCSRFToken(),
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/vnd.turbo-stream.html'
        }
      })
      
      if (response.ok) {
        // Turbo Streamを処理
        const responseText = await response.text()
        Turbo.renderStreamMessage(responseText)
      }
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error)
    }
  }

  getCSRFToken() {
    const token = document.querySelector('meta[name="csrf-token"]')
    return token ? token.content : ''
  }
}
