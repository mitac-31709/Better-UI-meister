// Configure your import map in config/importmap.rb. Read more: https://github.com/rails/importmap-rails
import "@hotwired/turbo-rails"
import "controllers"
import "channels"

// Turbo Frameのエラーハンドリング
document.addEventListener('turbo:frame-missing', (event) => {
  console.log('Turbo frame missing:', event.detail)
  // 必要に応じてリダイレクトやエラー処理を行う
})

document.addEventListener('turbo:frame-load', (event) => {
  console.log('Turbo frame loaded:', event.target.id)
})

// ページ遷移時のサイドパネル管理
document.addEventListener('turbo:before-visit', (event) => {
  // サイドパネルをリセット
  const sidePanel = document.querySelector('#side_panel')
  if (sidePanel && !sidePanel.classList.contains('translate-x-full')) {
    sidePanel.classList.remove('translate-x-0')
    sidePanel.classList.add('translate-x-full')
    // 少し遅らせてコンテンツをクリア
    setTimeout(() => {
      if (sidePanel) {
        sidePanel.innerHTML = ''
      }
    }, 100)
  }
})

// 行クリック処理
window.handleRowClick = function(event, url) {
  // リンク要素をクリックした場合は、デフォルトの動作を維持
  if (event.target.tagName === 'A' || event.target.closest('a')) {
    return;
  }
  
  // 他の要素をクリックした場合はTurbo Frameで読み込み
  if (url) {
    const turboFrame = document.querySelector('turbo-frame[id="side_panel"]');
    if (turboFrame) {
      turboFrame.src = url;
    } else {
      // Turbo Frameが見つからない場合は通常のナビゲーション
      window.location.href = url;
    }
  }
}
