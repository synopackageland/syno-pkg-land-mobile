# Changelog

## Unreleased

- Text fields (sign-in, Add NAS, the browser page's Add NAS) show focus on the whole rounded field: its edge and icon turn the accent colour. Before, the browser drew its own square ring around the text area only, beside the icon. Every boxed field now shares one component, so the icon, text and buttons sit at the same spacing in each.
- Dashboard pages fit a phone (Container Manager's overview at 360 and 390 px). The status card is as tall as its content, with its icon and title row inside its top padding, cards in a row that wraps fill the screen's width, and a card header's title and its CPU / Memory / Network switch each keep one line. A page that hid what ran past its bottom now scrolls, so the usage chart shows whole.
- DSM toolbars with a filter menu and a search box keep their buttons on screen (Container Manager's Log lost Clear and Export). Label/value cards no longer show "undefined:" for a column with no title, or an empty Actions line.
- Opening an App inside a package page that runs its own DSM desktop (Surveillance Station's Monitor Center, Recording, IP Camera, Log and so on) responds at once, as on DSM's desktop: the App's icon with a turning arc and its name show on the tap, and fade into the App when its window is ready. Back while it opens cancels it. The arc has no grey track and stays still with reduced motion.
- A DSM App that is slow to open in the warm page keeps opening there instead of being restarted in a page of its own after 8 s, which booted DSM again. "Still opening" now offers Back as well as Reopen, in the Android App and the browser page.
- The Android App prepares a new App view's bridge, fit and insets together, so its page starts loading sooner after the tap.
- Apps whose window is a Vue 3 component (Surveillance Station 9's Event Center) open full screen like any other App. Before, the window opened behind the list, so the tap seemed to do nothing.
- A window that shows while DSM's loading mask is still on it comes into view after 1.5 s, under DSM's own mask, instead of the opening cover waiting for the mask to go.
- A side panel stacked with the content on a phone (the "Filter by" lists of IP Camera, Recording and Log) folds to a bar with its own label at the edge of the content, which keeps the screen. A tap opens it, and another tap folds it again.
- Panes drawn side by side with flex boxes, where fixed panes leave the main one too little room (Monitor Center's layout tree and alert list, Event Center's Search & Filter), stack into a column: the main pane takes the height and each fixed pane folds to a bar that opens on a tap. Before, Monitor Center's live view was pushed off the screen.
- A dialog whose content runs past its own edge, such as Event Center's welcome page with its picture beside the text, wraps that row and scrolls, so its text shows.
- Monitor Center opens straight into its phone layout: its panes fold under the opening cover and as the page draws them, so the side-by-side desktop layout no longer shows for a moment first.
- In a dialog that flows on a phone, a small control pinned near its bottom (Event Center's welcome pager) moves below the text instead of covering its last line.
- List summaries laid out as a table (Surveillance Station's Recording list) put each cell on its own line on a phone, and words break only when longer than the line. Before, a time or an event type broke letter by letter in a cell squeezed beside the camera name.
- Adding a NAS whose certificate this phone can't verify (self-signed, or issued for a domain while the NAS is added by IP) opens the certificate for review as soon as the address is found: the address, who it is issued to and by, the expiry date and the SHA-256 fingerprint, with Allow and Cancel. Allow saves the NAS with that exact certificate and goes on to sign in; Cancel keeps the result, and the trust row opens the review again.
- An expired certificate is named as such with how to renew it, instead of being saved and failing later; when the NAS also answers over plain HTTP, that address is chosen instead.
- The browser page tells a certificate it refused from a NAS that does not answer: a quick refusal reads "This browser may not trust the certificate of …", explains that a page can't accept it, and offers to open that exact HTTPS address in a new tab before Retry. A NAS that does not answer gets a network hint instead.
- Surveillance Station 9, whose desktop is drawn without DSM's own App list, opens as its list of Apps too, read from the desktop icons; when a desktop's Apps can't be read at all, it shows as it is instead of an empty dark backdrop.
- The browser page's Add NAS answers in about a second when nothing answers at the address, and within a few seconds for a NAS without a phone launcher, instead of always waiting ten seconds.

- Pull down on Home, Apps or Notifications to refresh in the browser page too, as in the Android App: a pull from the very top of the list shows a round indicator that follows the finger, and a release past the threshold reloads that tab while its current data stays on screen. Scrolling, sideways swipes and the browser's own pull-to-reload are left alone, and a pull never opens the App under the finger. Android keeps its platform indicator, now in the accent colour through the same shared control, which any list can use.
- Notifications show the offline line with Retry when a refresh fails over saved notices, and the cause with Retry when nothing is saved yet, instead of "No notifications".

- The browser page adds a NAS that has no phone launcher instead of stopping at "needs Connect": it joins the NAS list with a small open-in-new mark, and picking it opens that NAS's DSM in a new tab. When the NAS later has a launcher, the list notices in the background and opens the launcher from then on.
- When nothing answers at an HTTPS address, usually because this browser does not trust the NAS certificate yet (self-signed, or issued for a domain while the NAS is added by IP), Add NAS offers Open DSM to accept the certificate, then checks again on its own when you come back, with Retry and Add anyway beside it.
- The browser page's Add NAS copy no longer presents Connect as a requirement: the address hint reads "NAS HTTPS address or domain" in every language.

- Surveillance Station on a phone opens as a list of its Apps (cameras, monitor center, recordings, logs and so on) instead of its desktop under a dark backdrop. Tapping one opens it full screen as a single App; back closes its dialogs first and then returns to the list. The rule applies to any package page that runs its own copy of DSM's desktop.
- Virtual Machine Manager's overview counts (hosts, virtual machines, storage) fit a 360 px phone: the three cards become a grid, so their titles and numbers show whole instead of being cut and spilling out of their cards. Cards filled in after their row is laid out are now laid out again.
- Label and value lists on a phone, such as Container Manager's project cards, show each label and its value on one line: the labels in a column of their own width (at most 40% of the card), the values left-aligned beside them, a long value such as a path wrapping in its column. A status dot sits at the start of its line instead of the middle of the card.
- Virtual Machine Manager's overview list shows the host name whole above its CPU, RAM and network figures, and the row's separator sits under the network speeds instead of through them.
- Active Backup for Business Portal no longer slides sideways on a phone. Its header bar, set to a desktop width, is fitted to the screen; WebKit reported its right margin as negative, which hid how much too wide it was.
- Synology Tiering's overview fits the phone without scrolling sideways: its legend wraps instead of cutting its entries to a few characters (which made the page widen), the menus in card headers give up their desktop width, and a number stays on one line with its unit, such as "1.2 TB".
- Synology Chat shows the conversation at the full width on a phone, with the channel list as a menu behind the hamburger, as Control Panel does. Its search box gets a line of its own above the conversation, and the message box and Send button fit the screen.
- Floating panels placed past the screen, such as the search options on Synology Chat's admin console, are narrowed to the screen and moved inside it. A search box set to a desktop width there fills the page's width instead of shrinking to nothing.
- Rows of fixed boxes that line up as a table, such as Active Backup for Business's backup calendar (a week label and seven day boxes per row), keep their columns lined up on a phone. When a card is too narrow for a row, each row stays on one line, scaled down to the card's width; when that would shrink it too much, the rows scroll sideways in their box instead. A single row of icons that wraps on purpose is left alone.
- A DSM dialog whose content the App sizes wider than the screen, such as Synology Drive's first-run welcome, fits the phone's width: its picture, title and text are capped at the screen and laid out again, instead of the dialog scrolling sideways with its right side cut off.

- DSM grid headers in Chinese or Japanese no longer break one character per line on a phone, such as "大小" over two lines in Active Backup for Business Portal's file list. A header of up to four characters stays whole on one line, and a longer one breaks once, in the middle. When the headers then need more room than the screen, the grid scrolls sideways in its own box with its first column pinned, as for other wide grids.

- Synology Drive and Active Backup for Business Portal show their category or folder tree as a menu behind the hamburger on a phone, as Control Panel does, and the file list takes the full width. Their tree sits in a split beside an icon rail or inside a padded main panel, which the menu rule did not look into before.
- Active Backup for Business Portal opens sooner in the browser page: it cannot open inside the shared DSM page (it stops on a script error first), and the page now hands it to a page of its own about a second after that error instead of after eight seconds. Portal's own loading after that is unchanged.
- A main panel padded for a desktop window, such as Active Backup for Business Portal's, keeps narrow phone gutters and the full width, and a header bar set to a desktop width fits the screen instead of cutting off its right side.
- Cards floated side by side that cannot fit their content, such as Active Backup for Business's overview with its backup calendar and protected devices, stack on a phone, each at the full width, so the calendar keeps its week rows and the device counts their names.

- A row of panels that runs past its edge on a phone, such as the host menus under Log Center's log count on a NAS with several hosts, stacks: one panel under another, each as wide as the widest, so no menu is cut off at the card's edge. A row whose panels the App later empties (the menus hidden on a NAS with one host) leaves the grid, and the card gets its own height back.
- A chart the phone widens keeps the time labels along its axis whole. The small blank boxes DSM places over a chart's ends, to hide the labels sliding out, stayed where the narrow chart had ended and cut a label in the middle of the axis ("1 4" for "15:14"); they now sit at the widened chart's edge.
- A row of charts side by side that a phone squeezes, such as Log Center's log count next to the pie of logs per host on a NAS with several hosts, stacks on a phone: each chart takes the full width, one under the other, with the pie's labels and the host menus below them in view. The panel around the row grows with it.
- In the browser page, an App whose launch page loads quickly, such as Connect or Reclaim, opens instead of loading forever. The page noticed the App's document after it had already finished loading, and then waited for a load that had already happened.
- DSM grids fit a phone with one rule for every grid. Each column keeps at least its header (on up to two lines) or its usual value, such as an icon, a short level word or a date; the widest text column takes the rest and wraps to up to three lines instead of one cut-off line, as in Security Advisor's results. When the columns still need more room, the grid scrolls sideways in its own box with its first column pinned, and the page keeps the screen's width. Grids with fixed row heights, such as Log Center's logs, keep one line per cell and show their usual values whole.
- A DSM grid that scrolls sideways on a phone, such as "Last 50 logs" on Log Center's overview, keeps its pinned first column solid and lined up: the pinned cells have the card's background (with DSM's tint on hovered and selected rows), so the columns scrolling under them no longer show through, and the header scrolls with the rows. Grids that DSM draws with its own scroller, such as Log Center's logs and Directory Server's users and computers, now scroll sideways at all, and their last row clears the scroll bar.
- Tapping a grid row whose cells are cut off shows a small details button at the row's end. It opens a sheet from the bottom with every column of the row as "header: value". The row's own tap, selection and double tap work as before, and Back closes the sheet.
- Package Center's installed list stays fitted while DSM refreshes it: rows it draws again wrap before they show, and a page that changed many times in a row is fitted again once it is quiet, without a tap. The Update button is no longer cut off at the screen's edge.
- A chart left alone in its row on a phone, such as Log Center's log count when DSM hides its legend, takes the full width instead of a narrow strip, and is drawn again at that width.
- The browser page's Add to Home Screen card is now in the same language as the rest of the page. It used to follow the browser's first preferred language, so a phone set to English with the page in Chinese showed the card in English.
- Add NAS in the browser page no longer suggests a QuickConnect ID in its address field: a browser cannot add a NAS by QuickConnect ID. The App still offers it.
- The browser page suggests adding it to the home screen. On an iPhone or iPad in Safari, a small card on the home page shows the three steps (Share, Add to Home Screen, Add); in Chrome on Android it has an Add to Home Screen button. The card sits above the home page content, never over it, and closing it hides it for good in that browser. Added, the page opens full screen with its own name and icon, clear of the notch and the Home indicator. The card's text is in nine languages.
- Add NAS accepts a QuickConnect ID, `ID.quickconnect.to` or `quickconnect.to/ID`. The App asks QuickConnect where the NAS is and remembers the ID, so each connection finds it again: its LAN address at home, an outside address or Synology's relay elsewhere. Every address must answer with that NAS's own fingerprint. In a browser, QuickConnect is not available (Synology's service does not answer web pages), and Add NAS says so and suggests the NAS's HTTPS address instead.
- Add NAS tries every address at once, with no short time limits. It takes the best one as soon as nothing better can still answer, stops the rest, and shows a lesser answer only after a short wait for a better one.
- When no address answers, Add NAS names the main cause and the next step, such as "This phone can’t find the name nas.example.com" with "Use the NAS IP address or QuickConnect ID". Each address's own result is under Show details.
- In a browser on an HTTPS page, an http:// address now explains that the browser blocks HTTP from HTTPS pages, instead of trying only HTTPS and reporting that the NAS can’t be reached.
- Typing in a text field no longer zooms the page on iPhone and cuts off its right side: every field uses 16px text, the size below which iOS Safari zooms in.
- The CPU, memory, network, drive and temperature numbers on the home screen and the Overview update calmly. A number that really changed counts to the new value in a few round steps over half a second, in the new value's unit and decimals; a small change, or a change of unit such as KB/s to MB/s, switches at once. Rates keep one decimal below 100 (2.0 KB/s), so they no longer change width from one update to the next. With "remove animations" on, the numbers switch without motion.
- Cards in a DSM card grid, such as SAN Manager's overview, show their right border: content a stylesheet makes wider than the card (a desktop minimum width) now fits inside it.
- DSM status headers whose title wraps on a phone, such as "Synology Drive Server is in good status" on Drive Admin Console's overview, no longer draw the title's second line over the description: the title takes the height of its lines and the header stacks again below it.
- DSM tables drawn as rows of one-line cells, such as the host usage on High Availability's overview, no longer draw wrapped labels and load averages over the next row: each cell grows to hold its wrapped text.
- DSM pages with rows of cards fit a phone. Summary cards that were cut off side by side, such as SAN Manager's overview, form a two-column grid; tall cards, such as Resource Monitor's charts and Hyper Backup's task panels, take the full width, and the page scrolls to the rest.
- Expandable DSM lists, such as SAN Manager's LUN and target lists, show each row in full: the name first, then each column on its own line, with long values such as IQNs wrapped instead of cut off.
- Package Center's installed list shows full package names and their status messages, with the action button below.
- The CPU and memory lines on the Overview are one unbroken line that scrolls smoothly, a few seconds behind the numbers. A missed or slow update no longer leaves gaps; the line carries on at the last value. With "remove animations" on, the lines and numbers update without motion.
- The Overview reads CPU and memory every 5 seconds while it is on screen, and stops when you leave it or the App or browser tab goes to the background. It does not need DSM's usage history.

## 0.3.2

- Back looks the same everywhere: one thin arrow in every App's top bar. In DSM layout Apps, the arrow, App icon, title and subtitle line up on one row with even spacing.
- Apps built with the Package Land UI kit show a Back arrow at the start of their phone title bar and return to the App list when you tap it. In a browser, they look as before.
- DSM pages with a side menu next to their content, such as AI Console, open with the content filling the screen. The menu button opens the side menu.
- Squeezed DSM layouts fit better on a phone. Labels go above values that were cut to a few characters, boxes wider than the screen are kept inside it, rows that ran past the edge wrap, and panels grow to fit their content.

## 0.3.1

- DSM Apps open their content first. The side menu stays closed until you tap the menu button, and lists such as Security Advisor's categories no longer draw over the open menu.
- Every DSM App opens on the first tap. The "Open anyway" prompt for Apps without a phone layout is gone.
- The Apps section for Apps without a phone layout is named "DSM layout".
- On a NAS with many drives and volumes, the Overview stays short: the fullest volumes and only drives with problems, with a count of the rest. The storage page puts problems first, and long drive models no longer hide temperature and status.
- The NAS line at the top of the Overview is a single short line.

## 0.3.0

- New layout with three tabs: Overview, Apps and Notifications. Each tab keeps its own pages, and tapping the current tab again returns to its top. Pages slide in and out, and Apps slide in when opened and out when closed. With "remove animations" on, pages switch at once.
- The NAS switcher shows each NAS's last known state, such as "Healthy · 3 min ago" or "Sign-in needed". Manage NAS moves into the switcher.
- The Overview starts with a single status line and a "Needs attention" list, followed by resources, volumes and backup. Status pages show storage pools with their drives and volumes, Security Advisor results, Hyper Backup tasks, and DSM's own CPU and memory history.
- Features your DSM version or account cannot use show "Open in DSM" or are hidden instead of failing. Rows that change settings open the matching DSM App.
- Notifications can be filtered by Errors, Warnings and Info, are split into New and Earlier, and fold repeats of the same notice into one row with a count. An opened notice can open its App in DSM. Unfilled placeholders and raw string keys no longer appear in notices.
- A denser Apps grid, with search in the Apps tab and a badge on desktop Apps only in search results.
- In Chinese, the Apps tab is named 「App」, as in DSM.

## 0.2.0

- Sign in natively: a built-in form signs you in to DSM, supports 2-step codes and remembers the phone as a trusted device. DSM web sign-in stays one tap away for passkeys, approvals and SSO.
- Signing in on DSM's own page no longer stalls on some NAS.
- The launcher shows DSM's built-in Apps, such as Control Panel and Package Center, in DSM's main menu order and named in your phone's language.
- Real App icons: the Apps grid shows each App's own icon, follows the DSM menu order and lets you drag Apps to reorder them.
- Desktop DSM Apps open as single Apps on the phone and fit the screen, even on a slow NAS. Back closes menus, dialogs and stacked Apps first. Oversized content can be fitted or expanded, and squeezed Apps keep a readable minimum width with sideways scrolling.
- A new launch screen shows the App icon and name while an App opens, and App pages move above the keyboard.
- The home page shows your NAS status: CPU, memory, network, drive activity and storage capacity, plus DSM notifications.

## 0.1.1

- First release for website downloads.
