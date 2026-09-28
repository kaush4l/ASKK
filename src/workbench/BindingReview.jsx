'use client'

export default function BindingReview({ review, busy, tokenAvailable, onConfirm }) {
  if (!review) return null
  const legacy = review.kind === 'legacy'
  return <section className="binding-review" aria-labelledby="binding-review-heading">
    <h3 id="binding-review-heading">{legacy ? 'Confirm this workspace location' : 'Transfer to another workspace location'}</h3>
    <p>{legacy ? 'This saved workspace predates location tracking. Review the folder before connecting its files.' : 'Your saved workspace belongs to another location. A transfer copies its committed files into an empty destination and preserves the original.'}</p>
    {review.previous && <div><span>Saved location</span><code>{review.previous.endpoint}</code><code>{review.previous.binding.root}</code></div>}
    <div><span>{legacy ? 'Folder to use' : 'Destination'}</span><code>{review.proposed.endpoint}</code><code>{review.proposed.binding.root}</code></div>
    {!legacy && <p>Reconnect and start the saved location first if it is not currently running. Unsaved editor drafts remain in the editor.</p>}
    <button className="button subtle" disabled={busy || !tokenAvailable} onClick={onConfirm}>{legacy ? 'Use this workspace folder' : 'Transfer committed snapshot'}</button>
  </section>
}
