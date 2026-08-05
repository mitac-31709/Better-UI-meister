import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="sortable-table"
export default class extends Controller {
  static values = {
    sortBy: String,
    sortDirection: String
  }

  connect() {
    this.updateSortIndicators()
  }

  sort(event) {
    event.preventDefault()
    const button = event.currentTarget
    const column = button.dataset.column

    // Toggle direction if clicking the same column
    let direction = 'asc'
    if (this.sortByValue === column) {
      direction = this.sortDirectionValue === 'asc' ? 'desc' : 'asc'
    }

    // Build URL with current params
    const url = new URL(window.location.href)
    url.searchParams.set('sort_by', column)
    url.searchParams.set('sort_direction', direction)
    
    // Reset to page 1 when sorting
    url.searchParams.set('page', '1')

    // Navigate to the new URL
    window.location.href = url.toString()
  }

  updateSortIndicators() {
    // Remove all sort indicators first
    this.element.querySelectorAll('[data-action*="sortable-table#sort"]').forEach(button => {
      const icon = button.querySelector('.sort-icon')
      if (icon) {
        icon.innerHTML = this.getUnsortedIcon()
      }
    })

    // Add indicator to active sort column
    if (this.sortByValue) {
      const activeButton = this.element.querySelector(`[data-column="${this.sortByValue}"]`)
      if (activeButton) {
        const icon = activeButton.querySelector('.sort-icon')
        if (icon) {
          icon.innerHTML = this.sortDirectionValue === 'asc' 
            ? this.getAscIcon() 
            : this.getDescIcon()
        }
      }
    }
  }

  getUnsortedIcon() {
    return `
      <svg class="w-4 h-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
      </svg>
    `
  }

  getAscIcon() {
    return `
      <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"/>
      </svg>
    `
  }

  getDescIcon() {
    return `
      <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"/>
      </svg>
    `
  }
}
