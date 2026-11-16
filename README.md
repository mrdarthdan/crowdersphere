# CrowderSphere

A Windows desktop editor for writing WordPress posts. You write in a WYSIWYG editor, add and arrange pictures, and the posts stay saved as folders on your PC. When you're ready, one click sends the post and its pictures to your blog.

## Install

1. Right-click **CrowderSphere.zip** and choose **Extract All**.
2. Open the extracted folder and double-click **Setup.cmd**. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**. The app isn't code-signed, which is why you see this.
3. In the setup window, click **Install**. You can change the install folder and choose whether to add a desktop shortcut.

Setup installs CrowderSphere just for your Windows account, so you don't need admin rights. Nothing is downloaded. Setup:

- builds **CrowderSphere.exe**
- adds CrowderSphere to the Start menu (and, if you chose it, the desktop)
- registers the app in **Settings → Apps → Installed apps**

**Updating:** run Setup.cmd from a newer copy and click **Update**. Your posts and WordPress connection are kept.

**Uninstalling:** go to **Settings → Apps → Installed apps → CrowderSphere → Uninstall**. Your posts are never deleted. The uninstaller asks whether to also forget your WordPress connection.

You need Windows 10 or 11 with Microsoft Edge, which is built in.

## Connect your blog (one time)

1. In WordPress, go to **Users → Profile → Application Passwords**.
2. Type "CrowderSphere" and click **Add New Application Password**, then copy the code it shows.
3. In CrowderSphere, click **Settings**. Enter your site address (for example `https://myblog.com`), your WordPress username and the application password.
4. Click **Save & test connection**.

The application password is stored encrypted under your Windows account in `%APPDATA%\CrowderSphere\settings.json`. To revoke access at any time, delete the password in WordPress.

## Writing

- **Formatting:** paragraph, headings, quote and code styles; bold, italic, underline and strikethrough; bulleted and numbered lists; text alignment; links; divider lines; undo and redo. The **</>** button lets you edit the raw HTML.
- **Pictures:** use the picture button, drag files onto the page, or paste from the clipboard. Click a picture to:
  - float it left or right so text wraps around it, or center it
  - set its size (S/M/L/Full, or the slider)
  - add a caption and alt text
  - make it the featured image
  - move it up or down, or delete it
- Large photos are shrunk (1920 px wide by default, which you can change in Settings). Hidden camera data, including GPS location, is removed.
- **Pasting from Word or Google Docs** keeps bold, italic, headings, lists and links, and strips the messy styling.
- **Post settings** (panel on the right): excerpt, categories (loaded from your site, and you can add new ones), tags and the featured image.
- **Featured image:** in the panel, click **Choose image...** or drop a picture onto the box. The image doesn't have to appear in the post body. You can also click a picture that's already in the post and choose **★ Featured**. Preview shows the featured image above the post, as most WordPress themes do.
- **Fonts:** choose a writing font and text size in Settings. These control how the editor looks, and Word exports use the same font too. To change the font of specific words in the post itself, select them and use the font menu in the toolbar.
- **Zoom:** use Ctrl + mouse wheel, Ctrl + / Ctrl − (Ctrl 0 resets), or the − 100% + control at the bottom right. Zoom only enlarges the text body, not the menus, and it's remembered.
- **Page width:** the writing page stretches to fill the window as you resize or maximize it. In Settings you can switch to *Wide* or *Reading column* if you prefer a narrower page. On small windows the post-settings panel slides over the page; use its Close button or the panel button at the top right.
- **Dark mode:** the moon/sun button at the bottom left switches between light and dark. In Settings you can also choose *Match Windows*.
- **Word and character count:** shown at the bottom, plus a count for any text you've selected. Click the count for full statistics: paragraphs, sentences, reading time, and title and excerpt length for search engines.
- **Spell check:** misspelled words get a red underline as you type. Right-click one for suggestions or *Add to dictionary*. The ABC button turns spell checking on or off. Spelling languages, and Microsoft Editor grammar checking, are set in Edge: open `edge://settings/languages`.
- Changes save automatically. Ctrl+S saves right away. Ctrl+K inserts a link, and Ctrl+N starts a new post.

## Where your posts live

By default posts go in `Documents\Blog Posts`, and you can change this in Settings. Each post is a folder:

```
2026-11-07-hiking-bryce-canyon/
  Hiking Bryce Canyon.docx   <- only if you exported to Word
  post.html     <- the post content (normal HTML; image paths are relative)
  post.json     <- title, categories, tags, WordPress post ID, upload history
  images/       <- the pictures used in the post
```

These are plain files, so you can back them up, sync them with OneDrive, or open post.html in a browser.

## Export to Word / Google Docs

Click **Export to Word** at the top. It saves a real Word document (`<post title>.docx`) in the post's folder, with the following kept:

- headings, formatting and links
- lists, quotes and tables
- pictures, including their size, alignment, captions and text wrap

After exporting you can open the document in Word. For Google Docs, upload the .docx to Google Drive, right-click it and choose **Open with → Google Docs**.

The export is a copy. Edits you make in Word don't come back into CrowderSphere, so export again whenever you want a fresh copy.

## Sending to WordPress

Click **Send to WordPress** and choose **Save as a draft**, **Publish now** or **Schedule for later**. CrowderSphere will:

1. Upload any new or changed pictures to your Media Library. Pictures already uploaded are reused, not duplicated.
2. Create the post, or update it if it was sent before, with the title, content, excerpt, categories, tags (new tags are created for you) and featured image.

The sidebar badge shows each post's status: **Local only**, **WP draft**, **Scheduled** (with its date), **Published**, or **Edited** (you've made changes since you last sent it). From the post panel you can open the post on your site or in WP Admin.

### Scheduling a post

Choose **Schedule for later** and pick a date and time (or click **Tomorrow 8 AM** / **Saturday 8 AM**). Times are in your computer's time zone. WordPress holds the post and publishes it on its own at that time, so your PC doesn't need to be on.

To change a scheduled post, click **Send to WordPress** again. You can send your edits and keep or move the time, **Publish now instead**, or **Unschedule** it back to a draft. Once the time passes, CrowderSphere checks with WordPress and switches the badge to **Published**.

## Troubleshooting

- **"HTTP 401" when testing the connection:** check the username and application password. Some web hosts strip login headers. Ask your host to pass the `Authorization` header through, or install a plugin that fixes "Application Passwords not working".
- **"rest_cannot_create":** your WordPress account role can't publish. Use an Author, Editor or Administrator account.
- **Nothing opens:** CrowderSphere runs a small private web server at `http://localhost:47821` and opens it in an Edge app window. Check that nothing else is using port 47821. The log file is `%APPDATA%\CrowderSphere\log.txt`.
- **Closing:** close the window. The background part exits on its own a few seconds later.

CrowderSphere works with self-hosted WordPress (WordPress 5.6 or newer). It also works with WordPress.com sites on plans that support plugins and application passwords.
