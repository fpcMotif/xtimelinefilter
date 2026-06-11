# 0001: Accepted Clicks Over Fired Events

## Context

Lasso repeatedly failed to hide posts on X even though it could open the caret menu and dispatch clicks against "Not interested in this post".

## Lesson

For third-party web apps, "we fired a click" is not the same as "the app accepted the action." The test must assert an external side effect that belongs to the target app.

In this case, the useful proof was:

- the caret menu closes after the menu item is accepted;
- the original tweet is replaced or removed;
- the feedback panel appears;
- the post-level feedback button such as "This post is not relevant" is clicked;
- failure to observe those effects reports failure instead of success.

## Consequence

Future fixes for X menu actions should verify target-site state changes. If the site ignores isolated-world synthetic clicks, add the smallest possible main-world bridge and keep an isolated-world fallback.

## Review Checklist

- Did the test model the live DOM shape?
- Did the test prove the site accepted the action?
- Did the code fail honestly when the site did nothing?
- Did the built manifest include the content script Chrome actually needs?

