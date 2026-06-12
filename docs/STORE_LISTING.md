# Chrome Web Store Listing Draft

Drafted from the current `manifest.json` and source code on 2026-06-12. The Chrome Web Store dashboard has not been updated from this repository.

Official references checked:

- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/best-listing

## Canonical Behavior Summary

Video Theater applies CSS picture filters to web page `video` elements. The user opens the toolbar popup, adjusts brightness, contrast, saturation, and warmth, then optionally saves the current filter values as one of three quick settings for the current domain. When auto-apply is enabled, the extension restores the last saved or selected quick setting for that domain on matching pages.

Stored data stays in `chrome.storage.sync` and includes saved page URLs, hostnames/domain labels, quick-setting slots, filter values, selected timestamps, updated timestamps, and the auto-apply option. The extension does not send data to developer servers or third-party services.

## Dashboard Fields

- Name: Video Theater
- Primary category suggestion: Accessibility
- Default language: English
- Package locales: `en`, `zh_TW`, `zh_CN`, `ja`, `ko`
- Homepage URL: https://tokenyet.github.io/video_theater/
- Privacy policy URL: https://tokenyet.github.io/video_theater/privacy.html
- Support URL: https://tokenyet.github.io/video_theater/support.html

## Graphic Assets

- Store icon: `icons/icon128.png`
- Required screenshots: prepare at least one 1280x800 screenshot, preferably localized per package locale
- Required small promo tile: prepare one global 440x280 PNG or JPEG
- Optional marquee tile: prepare one global 1400x560 PNG or JPEG only if needed

Promotional images are global rather than locale-specific in the Chrome Web Store. Prefer little or no text in promo tiles.

## English (`en`)

### Name

Video Theater

### Short Summary

Adjust video brightness and save per-site presets for darker or brighter viewing environments.

### Detailed Description

Video Theater gives you quick picture controls for videos on the web. Open the toolbar popup, tune brightness, contrast, saturation, and warmth, then save the result as one of three quick settings for the current domain.

When you return to the same site, Video Theater automatically reapplies the last saved or selected quick setting for that domain. Each domain can keep up to three presets, so you can switch between common viewing corrections without cluttering the popup.

Use Preview default to temporarily return the current tab to neutral values without changing saved presets. Use Clear on a quick setting row to remove only that saved preset. The options page lets you manage saved presets, toggle auto-apply, or delete every saved preset from a clearly labeled danger zone.

### Feature Bullets

- Brightness, contrast, saturation, and warmth sliders
- Save up to three quick settings per domain
- Automatic preset application on matching pages
- Preview neutral values without deleting saved presets
- Quickly apply, overwrite, or clear domain presets from the popup
- Options page for managing saved presets and auto-apply
- Localized UI for English, Traditional Chinese, Simplified Chinese, Japanese, and Korean

### Privacy Summary

Video Theater stores user-created presets and the auto-apply option in browser sync storage. Presets include saved page URLs, hostnames, quick-setting slots, filter values, and timestamps. The extension does not collect analytics, send data to external servers, inspect video contents, or capture media.

### Screenshot Captions

- Adjust brightness, contrast, saturation, and warmth from the toolbar popup.
- Save three quick settings for a domain and reapply them later.
- Manage saved presets and auto-apply from the options page.

## Traditional Chinese (`zh_TW`)

### Name

Video Theater

### Short Summary

調整網頁影片亮度，並為每個網域儲存快速設定。

### Detailed Description

Video Theater 讓你快速調整網頁影片的畫面濾鏡。開啟工具列彈出視窗後，可以調整亮度、對比、飽和度與暖色，並把目前結果儲存成該網域的三組快速設定之一。

下次回到同一個網站時，Video Theater 會自動套用最後儲存或選擇的快速設定。每個網域最多可保留三組設定，方便在不同觀看環境之間切換。

使用「暫時回預設」可讓目前分頁回到中性值，且不會刪除已儲存設定。你也可以在彈出視窗清除單一快速設定，或到選項頁管理已儲存設定、切換自動套用，並在明確標示的危險區刪除所有設定。

### Feature Bullets

- 亮度、對比、飽和度與暖色滑桿
- 每個網域最多儲存三組快速設定
- 回到相同網站時自動套用設定
- 暫時預覽中性值，不刪除已儲存設定
- 從彈出視窗套用、覆寫或清除網域設定
- 選項頁可管理已儲存設定與自動套用
- 支援英文、繁體中文、簡體中文、日文與韓文介面

### Privacy Summary

Video Theater 只會在瀏覽器同步儲存中保存使用者建立的設定與自動套用選項。設定包含儲存時的頁面 URL、主機名稱、快速設定槽位、濾鏡值與時間戳。擴充功能不收集分析資料、不傳送資料到外部伺服器、不檢查影片內容，也不擷取媒體。

### Screenshot Captions

- 從工具列彈出視窗調整亮度、對比、飽和度與暖色。
- 為每個網域儲存三組快速設定並稍後套用。
- 在選項頁管理已儲存設定與自動套用。

## Simplified Chinese (`zh_CN`)

### Name

Video Theater

### Short Summary

调整网页视频亮度，并为每个域名保存快速设置。

### Detailed Description

Video Theater 可帮助你快速调整网页视频的画面滤镜。打开工具栏弹出窗口后，可以调整亮度、对比度、饱和度和暖色，并把当前结果保存为该域名的三组快速设置之一。

下次回到同一网站时，Video Theater 会自动应用最后保存或选择的快速设置。每个域名最多可保留三组设置，方便在不同观看环境之间切换。

使用“临时回默认”可以让当前标签页恢复到中性值，且不会删除已保存设置。你也可以在弹出窗口清除单个快速设置，或到选项页管理已保存设置、切换自动应用，并在明确标示的危险区删除所有设置。

### Feature Bullets

- 亮度、对比度、饱和度和暖色滑块
- 每个域名最多保存三组快速设置
- 回到相同网站时自动应用设置
- 临时预览中性值，不删除已保存设置
- 从弹出窗口应用、覆盖或清除域名设置
- 选项页可管理已保存设置和自动应用
- 支持英文、繁体中文、简体中文、日文和韩文界面

### Privacy Summary

Video Theater 只会在浏览器同步存储中保存用户创建的设置和自动应用选项。设置包含保存时的页面 URL、主机名、快速设置槽位、滤镜值和时间戳。扩展程序不收集分析数据、不向外部服务器发送数据、不检查视频内容，也不捕获媒体。

### Screenshot Captions

- 从工具栏弹出窗口调整亮度、对比度、饱和度和暖色。
- 为每个域名保存三组快速设置并稍后应用。
- 在选项页管理已保存设置和自动应用。

## Japanese (`ja`)

### Name

Video Theater

### Short Summary

Web 動画の明るさを調整し、サイトごとにクイック設定を保存します。

### Detailed Description

Video Theater は、Web 上の動画向けの簡単な画質調整ツールです。ツールバーのポップアップを開き、明るさ、コントラスト、彩度、暖かさを調整して、現在のドメインの 3 つのクイック設定のいずれかに保存できます。

同じサイトに戻ると、Video Theater はそのドメインで最後に保存または選択したクイック設定を自動的に再適用します。各ドメインには最大 3 つのプリセットを保存できるため、よく使う視聴環境をすばやく切り替えられます。

「一時的に既定値」を使うと、保存済みプリセットを変更せずに現在のタブだけ中立値に戻せます。ポップアップでは個別のクイック設定を削除でき、オプションページでは保存済みプリセットの管理、自動適用の切り替え、すべてのプリセット削除ができます。

### Feature Bullets

- 明るさ、コントラスト、彩度、暖かさのスライダー
- ドメインごとに最大 3 つのクイック設定を保存
- 一致するページで保存済み設定を自動適用
- 保存済みプリセットを削除せずに中立値を一時プレビュー
- ポップアップからドメイン設定を適用、上書き、削除
- オプションページで保存済みプリセットと自動適用を管理
- 英語、繁體中文、簡體中文、日本語、韓国語の UI に対応

### Privacy Summary

Video Theater は、ユーザーが作成したプリセットと自動適用オプションをブラウザの同期ストレージに保存します。プリセットには、保存時のページ URL、ホスト名、クイック設定スロット、フィルター値、タイムスタンプが含まれます。この拡張機能は分析データを収集せず、外部サーバーへデータを送信せず、動画の内容を検査したりメディアをキャプチャしたりしません。

### Screenshot Captions

- ツールバーのポップアップで明るさ、コントラスト、彩度、暖かさを調整。
- ドメインごとに 3 つのクイック設定を保存して再適用。
- オプションページで保存済みプリセットと自動適用を管理。

## Korean (`ko`)

### Name

Video Theater

### Short Summary

웹 동영상 밝기를 조정하고 사이트별 빠른 설정을 저장합니다.

### Detailed Description

Video Theater는 웹 동영상을 위한 간단한 화면 필터 도구입니다. 툴바 팝업을 열어 밝기, 대비, 채도, 따뜻함을 조정한 뒤 현재 도메인의 빠른 설정 3개 중 하나로 저장할 수 있습니다.

같은 사이트로 돌아오면 Video Theater가 해당 도메인에서 마지막으로 저장하거나 선택한 빠른 설정을 자동으로 다시 적용합니다. 도메인마다 최대 3개의 프리셋을 저장할 수 있어 자주 쓰는 시청 보정을 빠르게 전환할 수 있습니다.

기본값 미리보기를 사용하면 저장된 프리셋을 바꾸지 않고 현재 탭만 중립값으로 되돌릴 수 있습니다. 팝업에서 개별 빠른 설정을 삭제할 수 있고, 옵션 페이지에서 저장된 프리셋 관리, 자동 적용 전환, 모든 프리셋 삭제를 할 수 있습니다.

### Feature Bullets

- 밝기, 대비, 채도, 따뜻함 슬라이더
- 도메인별 빠른 설정 최대 3개 저장
- 일치하는 페이지에서 저장된 설정 자동 적용
- 저장된 프리셋을 삭제하지 않고 중립값 임시 미리보기
- 팝업에서 도메인 설정 적용, 덮어쓰기, 삭제
- 옵션 페이지에서 저장된 프리셋과 자동 적용 관리
- 영어, 중국어 번체, 중국어 간체, 일본어, 한국어 UI 지원

### Privacy Summary

Video Theater는 사용자가 만든 프리셋과 자동 적용 옵션을 브라우저 동기화 저장소에 저장합니다. 프리셋에는 저장 당시의 페이지 URL, 호스트 이름, 빠른 설정 슬롯, 필터 값, 타임스탬프가 포함됩니다. 이 확장 프로그램은 분석 데이터를 수집하지 않고, 외부 서버로 데이터를 보내지 않으며, 동영상 내용을 검사하거나 미디어를 캡처하지 않습니다.

### Screenshot Captions

- 툴바 팝업에서 밝기, 대비, 채도, 따뜻함을 조정합니다.
- 도메인별 빠른 설정 3개를 저장하고 다시 적용합니다.
- 옵션 페이지에서 저장된 프리셋과 자동 적용을 관리합니다.

## Translation Review

The localized listing copy is prepared from existing package locale strings. Native review is recommended before final dashboard submission.
