// Notification management
class NotificationManager {
  constructor() {
    this.init();
  }

  init() {
    this.updateNotificationBadge();
    // 5分ごとに通知数を更新
    setInterval(() => {
      this.updateNotificationBadge();
    }, 300000); // 5 minutes
  }

  async updateNotificationBadge() {
    try {
      const response = await fetch('/notifications/unread_count');
      const data = await response.json();
      this.updateBadge(data.count);
    } catch (error) {
      console.error('Failed to update notification badge:', error);
    }
  }

  updateBadge(count) {
    const badge = document.getElementById('notification-badge');
    const container = document.getElementById('notifications-container');
    
    if (!container) return;

    if (count > 0) {
      if (badge) {
        badge.textContent = count <= 99 ? count : '99+';
      } else {
        // バッジが存在しない場合は作成
        const link = container.querySelector('a');
        if (link) {
          const newBadge = document.createElement('span');
          newBadge.id = 'notification-badge';
          newBadge.className = 'absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center font-medium';
          newBadge.textContent = count <= 99 ? count : '99+';
          link.appendChild(newBadge);
        }
      }
    } else {
      // 未読通知がない場合はバッジを削除
      if (badge) {
        badge.remove();
      }
    }
  }

  // 通知を既読にした時にバッジを更新
  async markAsRead(notificationId) {
    try {
      const response = await fetch(`/notifications/${notificationId}/mark_as_read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
        }
      });
      
      if (response.ok) {
        this.updateNotificationBadge();
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  // すべての通知を既読にした時にバッジを更新
  async markAllAsRead() {
    try {
      const response = await fetch('/notifications/mark_all_as_read', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
        }
      });
      
      if (response.ok) {
        this.updateNotificationBadge();
        // ページをリロードして表示を更新
        if (window.location.pathname === '/notifications') {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  }
}

// DOMが読み込まれたら初期化
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('notifications-container')) {
    window.notificationManager = new NotificationManager();
  }
});

// 通知ページ固有の機能
document.addEventListener('DOMContentLoaded', () => {
  // 既読ボタンのクリックイベント
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-notification-read]')) {
      e.preventDefault();
      const notificationId = e.target.dataset.notificationId;
      if (window.notificationManager && notificationId) {
        window.notificationManager.markAsRead(notificationId);
      }
    }
  });

  // すべて既読ボタンのクリックイベント
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-mark-all-read]')) {
      e.preventDefault();
      if (window.notificationManager) {
        window.notificationManager.markAllAsRead();
      }
    }
  });
});
