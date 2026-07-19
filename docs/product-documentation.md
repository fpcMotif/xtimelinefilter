# Lasso Product Documentation

Status: living user guide. Verify screenshots against the release build.
Audience: regular users of Lasso

Lasso helps you add people from your X timeline to X Lists without leaving the feed. It works on x.com and gives visible feedback for every action so you know what happened.

## Screenshot Record

Screenshots are historical records captured from a built app with a local X timeline simulator and Chrome DevTools Protocol.

| Area | Screenshot |
| --- | --- |
| First-run welcome | [01-content-welcome.png](product-screenshots/01-content-welcome.png) |
| Select a person and open the List picker | [02-content-picker-error.png](product-screenshots/02-content-picker-error.png) |
| Keyboard shortcuts sheet | [03-content-shortcuts.png](product-screenshots/03-content-shortcuts.png) |
| Select mode at zero selections | [04-content-select-mode.png](product-screenshots/04-content-select-mode.png) |
| Not interested quick action feedback | [05-content-not-interested.png](product-screenshots/05-content-not-interested.png) |
| Toolbar popup, active tab | [06-popup-active.png](product-screenshots/06-popup-active.png) |
| Toolbar popup, asleep tab | [07-popup-asleep.png](product-screenshots/07-popup-asleep.png) |
| Toolbar popup after wake | [08-popup-after-wake.png](product-screenshots/08-popup-after-wake.png) |
| Settings page | [09-options-settings.png](product-screenshots/09-options-settings.png) |
| Privacy and data controls | [10-options-privacy-actions.png](product-screenshots/10-options-privacy-actions.png) |

## What Lasso Does

Lasso adds people to Lists, not posts. When you select a post, Lasso files that post's author into the List you choose.

Lasso keeps your flow on the timeline:

- Select one person from a post.
- Select many people across several posts.
- Pick a List with search and keyboard controls.
- See a success, retry, rate-limit, or undo message after the action.
- Use the timeline's not-interested action from the same context.

## First Run

When Lasso is installed, it opens X with the welcome experience.

### Lasso is ready

The welcome card explains the three main gestures:

- `Alt+L`: add the hovered or focused post author to a List.
- `s`: enter select mode for adding many people.
- `?`: open the keyboard shortcuts sheet.

Buttons:

- **Try select mode**: closes the welcome card and turns on select mode immediately.
- **Skip**: closes the card and leaves the timeline unchanged.

After either button, the welcome card does not keep appearing. You can bring it back later from Settings with **Replay intro**.

## Timeline Controls

### Selection Circle

When you hover a post, a small circle appears near the author's avatar.

Clicking the circle selects that person. The circle fills with a checkmark, and Lasso shows the action bar at the bottom of the page.

Clicking the selected circle again removes that person from the selection.

### First Hover Tip

The first time you hover a selectable post, Lasso may show a small tip: "Select - then add everyone to a List at once." This hint is temporary and is meant to teach the flow without staying in the way.

### Action Bar

The action bar appears when people are selected.

Buttons and controls:

- **Facepile / selected people button**: opens a review popover with one row per selected person.
- **Remove row button**: removes that person before you add anyone to a List.
- **N people selected**: confirms the count. The count is people, not posts.
- **Add to List**: opens the List picker.
- **Alt L hint**: may appear during onboarding to teach the keyboard shortcut.
- **X / clear selection**: clears the current selection.

Post-click behavior:

- Clicking **Add to List** keeps the selection and opens the List picker.
- Clicking **clear selection** removes all selected people and hides the action bar.
- Removing one person from the review popover updates the count immediately.

## List Picker

The List picker is where you choose the target X List.

### Ready State

When Lists are available, the picker shows:

- A header such as `Add @jane to a List` or `Add 3 people to a List`.
- **Search Lists** input.
- Recent Lists first when available.
- All other Lists below.
- Member counts when Lasso can show them.
- A lock icon for private Lists.
- A checkmark for Lists that already contain the selected person.

Keyboard controls:

- `Up` / `Down`: move through Lists.
- `Enter`: add to the selected List.
- `Esc`: close the picker.

### Loading State

If Lists are still loading, the picker shows skeleton rows instead of pretending the Lists are empty.

### Logged-Out or Load Error

If Lasso cannot load Lists, it shows **Couldn't load your Lists** and a reason such as **You may be logged out of X**.

Button:

- **Retry**: tries to load Lists again.

Keyboard:

- `r`: retries while the Retry button is focused.
- `Esc`: dismisses the picker.

### No Lists

If your X account has no Lists, the picker says **You don't have any Lists yet** and explains that Lists group people on X.

Button:

- **Create a List on X**: opens X's List creation page.

### No Search Match

If your search does not match any List, the picker shows the search term.

Buttons:

- **Clear search**: empties the search box and returns to the full List view.
- **Create "[term]" on X**: opens X's List creation page.

## Adding People To A List

After you choose a List, Lasso starts adding the selected people.

### Progress

For multiple people, the action bar becomes a progress surface such as `Adding 2 of 7 to Design Folks...`.

Button:

- **Stop**: stops the remaining additions. People already added are removed from the selection; people not yet attempted stay selected.

### Success

On success, Lasso shows a toast such as **Added 3 to Design Folks**.

Actions:

- **View List**: opens the X List.
- **Undo**: removes only the people Lasso just added. It does not remove people who were already in the List before this action.

Keyboard:

- `z`: triggers Undo while the undo window is active.

### Already In List

If a selected person is already in the target List, Lasso reports that clearly, for example **1 was already in the List**. This is treated as a safe result, not a hidden failure.

### Partial Failure

If some people are added and some fail, Lasso keeps failed people selected and shows a retry option.

Button:

- **Retry**: tries the failed or still-selected people again.

### Rate Limit

If X rate limits the action, Lasso stops the run and keeps remaining people selected. The rate-limit toast does not auto-dismiss.

## Select Mode

Select mode is for collecting several people before choosing a List.

Entry points:

- Press `s`.
- Click **Try select mode** on the welcome card.

When select mode is on, Lasso shows the action bar even at zero selected people: **Select mode - click posts or press x - s when done**.

Operations:

- Click a post body to toggle that post's author.
- Press `x` to toggle the focused post's author.
- Press `s` again or click **Done** to leave select mode.

Post-click behavior:

- Leaving select mode does not clear your selection.
- Selected people remain selected while you scroll.
- The toolbar badge mirrors the selected count.

## Keyboard Shortcuts

Press `?` on x.com to open the shortcuts sheet.

Current shortcuts:

| Shortcut | Action |
| --- | --- |
| `Alt+L` | Add the author to a List. If nobody is selected, Lasso uses the hovered or focused post. |
| `Alt+Shift+L` | Add straight to your default List. If no default List is set, Lasso opens the picker. |
| `Alt+N` | Mark the post as not interested. |
| `x` | Select the focused post. |
| `s` | Turn select mode on or off. |
| `f` | Turn the timeline filter on or off. |
| `h` | Show filtered posts; press again to re-hide them. |
| `?` | Show the shortcuts sheet. |
| `Esc` | Dismiss one Lasso layer at a time. |
| `z` | Undo the last undoable Lasso action. |

Lasso does not take over X's own `j` and `k` navigation shortcuts.
Mute has no default shortcut.

## Quick Actions

### Not Interested

Use `Alt+N` while hovering or focusing a post.

Success behavior:

- Lasso drives X's own post menu.
- Lasso verifies that X accepted the feedback.
- Lasso shows **Hidden - told X you're not interested**.

Failure behavior:

- Lasso shows **Couldn't hide that post** with **Retry**.

## Toolbar Popup

Click the Lasso toolbar icon to see the current tab state and the top shortcuts.

States:

- **Active on x.com**: Lasso is awake and ready on the current X tab.
- **Asleep - click to wake**: Lasso is installed but dormant on the current tab. Click the button to wake it.
- **Open x.com to use Lasso**: the current tab is not an X page where Lasso can run.

Button:

- **All settings**: opens the full settings page.

Post-click behavior:

- Clicking **Asleep - click to wake** wakes Lasso on the current tab and changes the popup state to **Active on x.com**.

## Settings

Open settings from the toolbar popup with **All settings**.

### Activation

Options:

- **On every visit (default)**: Lasso starts automatically on x.com.
- **Only when I use the toolbar or press `s`**: Lasso stays asleep until you wake it from the popup or enter select mode.

### How Lasso Talks To X

Options:

- **Drive X's own menus**: slower, requires a currently visible post, and uses only actions you could click yourself. Scrolled-away selections are not author-addressable through this adapter.
- **X's web REST endpoints**: fast and uses the same endpoints X's site uses. They are not X's developer API.
- **GraphQL**: fastest, but uses private endpoints and may break or be frowned upon.

Changing this setting affects future List actions.

### Default List

Choose a default List to make `Alt+Shift+L` add directly without opening the picker.

If no Lists are available yet, Lasso asks you to open x.com once so it can see your Lists.

### Keyboard Shortcuts

The settings page lists the active shortcuts. The same list appears in the `?` sheet on x.com.

### Accessibility

Option:

- **Higher-contrast buttons**: uses stronger button contrast.

### Privacy & Data

Lasso keeps your X session credentials between your browser and X. With Mirror configured, it sends its device key, Owner/List catalog, membership snapshots, and assignment audit events to your Convex deployment.

### Sync

Mirror sync is optional. Enter both a Convex deployment URL and device key to connect. Leave either blank: no Mirror connection.

Buttons:

- **Clear Lasso data**: clears cached Lists, List usage, settings, filter preferences, Mirror status, and onboarding hint state. After clicking, settings shows **Cleared**.
- **Replay intro**: makes the welcome card appear on your next visit to x.com. After clicking, settings shows **On your next visit to x.com**.

## Install And Uninstall Behavior

On install, Lasso opens `x.com/home#lasso-welcome` so the product itself teaches the first run.

On uninstall, Lasso opens a one-question feedback page. This is optional and is the product's feedback loop.

## Ongoing Documentation Notes

Keep this file as the living user guide:

- Add new screenshots under `docs/product-screenshots/`.
- Add new rows to the screenshot record instead of replacing old evidence without reason.
- Document user-visible behavior first: page, entry point, button, post-click result.
- Keep implementation details out of user sections.
- If a feature is only planned and not shipped, leave it out or mark it explicitly as future work.
