import consumer from "channels/consumer"

const reportEditChannel = {
  subscription: null,

  connect(reportId) {
    console.log('Connecting to ReportEditChannel with reportId:', reportId)
    
    this.subscription = consumer.subscriptions.create(
      { channel: "ReportEditChannel", report_id: reportId },
      {
        connected() {
          console.log("Connected to ReportEditChannel")
        },

        disconnected() {
          console.log("Disconnected from ReportEditChannel")
        },

        received(data) {
          console.log("Received data:", data)
          reportEditChannel.handleBroadcast(data)
        },

        acquireLock(fieldName) {
          console.log("Acquiring lock for field:", fieldName)
          this.perform('acquire_lock', { field_name: fieldName })
        },

        releaseLock(fieldName) {
          console.log("Releasing lock for field:", fieldName)
          this.perform('release_lock', { field_name: fieldName })
        },

        updateContent(fieldName, content) {
          console.log("Updating content for field:", fieldName, content)
          this.perform('update_content', { field_name: fieldName, content: content })
        }
      }
    )
  },

  disconnect() {
    if (this.subscription) {
      this.subscription.unsubscribe()
      this.subscription = null
    }
  },

  handleBroadcast(data) {
    const event = new CustomEvent('reportEditUpdate', {
      detail: data
    })
    document.dispatchEvent(event)
  }
}

export default reportEditChannel
