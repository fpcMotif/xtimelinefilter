# Glossary

## Accepted Click

A click whose target site processes the action and changes state. For the X caret menu, the menu closing or the tweet changing is stronger evidence than a JavaScript event firing.

## Isolated World

The Chrome extension content-script JavaScript environment. It can read and edit the DOM, but its synthetic events may not behave exactly like page-owned user events.

## Main World

The web page's own JavaScript environment. Code running here is closer to a userscript and can trigger page event handlers that may ignore isolated-world synthetic events.

## Side Effect

The observable result produced by the target site after an action, such as X replacing a tweet with a feedback panel after "Not interested".

