import s from './ui.module.css'

/**
 * THE ONE SURFACE (DESIGN.md §8, Surface / Card). A screen that hand-rolls a
 * bordered box is not done.
 *
 * The caption is an eyebrow and not a headline: a panel says what region it is
 * in the smallest register on the page, because the content is the thing being
 * read. `status` tints the left edge through `--tone` and is optional for the
 * reason the Badge exists — colour is never a channel on its own, so a panel
 * only ever carries a tone the words inside it already state.
 *
 * @param {{caption: string, status?: string, children: React.ReactNode}} props
 */
export function Panel({ caption, status, children }) {
  return (
    <section className={`${s.panel} ${status ? s.toned : ''}`} data-status={status}>
      <h2 className={s.caption}>{caption}</h2>
      {children}
    </section>
  )
}
