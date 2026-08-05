import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["badge", "container"]
  static values = { updateInterval: { type: Number, default: 300000 } } // 5分

  connect() {
    this.updateNotificationBadge()
    this.startPeriodicUpdates()
  }

  disconnect() {
    this.stopPeriodicUpdates()
  }

  startPeriodicUpdates() {
    this.intervalId = setInterval(() => {
      this.updateNotificationBadge()
    }, this.updateIntervalValue)
  }

  stopPeriodicUpdates() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  async updateNotificationBadge() {
    try {
      const response = await fetch('/notifications/unread_count', {
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      })
      
      if (!response.ok) throw new Error('Network response was not ok')
      
      const data = await response.json()
      this.updateBadge(data.count)
    } catch (error) {
      console.error('Failed to update notification badge:', error)
    }
  }

  updateBadge(count) {
    const badge = this.hasBadgeTarget ? this.badgeTarget : null
    const link = this.containerTarget.querySelector('a')
    
    if (count > 0) {
      const displayCount = count <= 99 ? count : '99+'
      
      if (badge) {
        badge.textContent = displayCount
      } else if (link) {
        // バッジが存在しない場合は作成
        const newBadge = document.createElement('span')
        newBadge.className = 'absolute top-0 right-0 h-5 w-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center font-medium transform translate-x-1 -translate-y-1'
        newBadge.textContent = displayCount
        newBadge.setAttribute('data-notifications-target', 'badge')
        newBadge.id = 'notification-badge'
        link.appendChild(newBadge)
      }
    } else {
      // 未読通知がない場合はバッジを削除
      if (badge) {
        badge.remove()
      }
    }
  }

  // 通知を既読にマークする
  async markAsRead(event) {
    event.preventDefault()
    const notificationId = event.params.id
    
    if (!notificationId) return
    
    try {
      const response = await fetch(`/notifications/${notificationId}/mark_as_read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.getCSRFToken(),
          'X-Requested-With': 'XMLHttpRequest'
        }
      })
      
      if (response.ok) {
        this.updateNotificationBadge()
        // Turbo Streamでページを部分更新
        if (response.headers.get('Content-Type')?.includes('text/vnd.turbo-stream.html')) {
          const responseText = await response.text()
          Turbo.renderStreamMessage(responseText)
        }
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }

  // すべての通知を既読にマークする
  async markAllAsRead(event) {
    event.preventDefault()
    
    if (!confirm('すべての通知を既読にしますか？')) return
    
    try {
      const response = await fetch('/notifications/mark_all_as_read', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.getCSRFToken(),
          'X-Requested-With': 'XMLHttpRequest'
        }
      })
      
      if (response.ok) {
        this.updateNotificationBadge()
        // Turbo Streamでページを部分更新
        if (response.headers.get('Content-Type')?.includes('text/vnd.turbo-stream.html')) {
          const responseText = await response.text()
          Turbo.renderStreamMessage(responseText)
        } else {
          // 通知ページにいる場合はリダイレクト
          if (window.location.pathname === '/notifications') {
            Turbo.visit('/notifications')
          }
        }
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
