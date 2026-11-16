# HandLab

**https://aveleage.github.io/handlab/**

Point a webcam at your mouse hand and see your wrist tension live. Everything runs in your browser, no video is sent anywhere, and nothing needs to be installed. It also works as an OBS overlay. The page is available in Japanese, English, Chinese (Simplified) and Korean.

Made by Racran ([X @1isss_](https://x.com/1isss_)). MIT License.

以下は開発用のメモです（日本語）。手元のフォルダでは `site/` に置いています。

HandLab は、ウェブカメラでマウスを握る手を映すと、手首のテンションをその場で表示するページです。
**計算はすべて、ページを開いている PC のブラウザの中で行います。** 映像はどこにも送りません。インストールは要りません。

録画・見返し・動画の書き出し・モデルの学習は、ブラウザ版にはありません（Python 版の役目です）。

名前について：公開するサービスの名前は **HandLab**。録画・学習用の Python 版（このフォルダの外）は、元の名前 AimHand のままです。

デザインは、Anthropic が公開している frontend-design スキル（Apache License 2.0）の指針に沿って作りました。考え方は `style.css` の先頭に書いてあります。

言語を足すときは、`strings.js` に同じキーで 1 言語ぶんを足し、`i18n.js` の `LANGS` に名前を足します（`tests/test_site.py` が、キーと穴がそろっているかを調べます）。

## ファイル

| ファイル | 役目 |
| --- | --- |
| `index.html` | 操作画面。カメラの開始、可動域の測定、OBS に映す範囲の指定、OBS 用の URL |
| `overlay.html` | 表示だけのページ。OBS に載せる。背景は透明 |
| `handlab.js` | 計算の中核（手の骨格 → 前腕の向き → 手首の角度 → テンション、描画、設定の保存） |
| `i18n.js`・`strings.js` | 画面の言語（日本語・英語・中国語（簡体字）・韓国語）。文言は `strings.js` にまとめてある |
| `style.css` | 見た目（操作画面とライセンスのページ） |
| `licenses.html`・`LICENSE.txt` | ライセンス（MIT、Copyright (c) 2026 Racran）と、使っているソフトの一覧 |
| `source.js` | 映像の入り口（カメラ。開発用に録画のコマも流せる） |
| `models/hand_landmarker.task` | 手の骨格のモデル（MediaPipe） |
| `models/armnet.onnx` | 前腕の向きのモデル（HandLab で学習した ArmNet） |

ライブラリは CDN（jsDelivr）から版を固定して読み込みます：`@mediapipe/tasks-vision@1.2.3`、`onnxruntime-web@1.31.1`。

## 手元で動かす

カメラは HTTPS か `localhost` でしか使えないので、フォルダをそのまま開くのではなく、簡単なサーバーを立てます。

`site.bat` をダブルクリックします。黒い窓が開き、ブラウザで `http://localhost:8080/` が開きます。

- **窓が開いている間が「起動中」です。** 窓の題名にも「起動中」と出ます。
- **止めるときは、その窓を閉じます。**
- 起動中にもう一度 `site.bat` を押すと、「すでに起動しています」と出て、ブラウザだけ開きます（二重には起動しません）。
- 起動しているか確かめるだけなら `site.bat --status`、窓が見つからないときに止めるなら `site.bat --stop`。

中身は `tools/serve_site.py` です（`python -m http.server 8080 --directory site` でも同じページは開けます）。

## 公開する

サーバー側の処理は無いので、`site/` の中身を置くだけの公開サービスで動きます（GitHub Pages、Cloudflare Pages など）。条件は HTTPS であることだけです。

- 置くのは `site/` の中身（`index.html` が一番上に来るように）。
- 独自ドメインは後から足せます。最初はサービスが出す無料のアドレスで公開できます。

決めたこと（2026-11-16）：**GitHub Pages** に、**ブラウザ版（`site/` の中身）だけ**を置く。アドレスは無料のもの（`aveleage.github.io/handlab/`）で始める。

1. GitHub に公開リポジトリを作る（`site/` の中身が一番上に来る形で送る）。
2. リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main` の `/ (root)` にする。
3. 数分後に `https://aveleage.github.io/handlab/` で開ける。

- `.nojekyll` は、GitHub Pages にファイルをそのまま出させるための空のファイルです（消さない）。
- 訪問の回数は GoatCounter（`racran.goatcounter.com`、Cookie なし）で数えています。タグは `index.html` にだけあり、OBS 用のページとライセンスのページでは数えません。`localhost` では数えません。
- 開発用の入力（`?frames=`）は、`localhost` で開いたときだけ有効です。公開サイトでは無視します。
- アドレスが変わると、OBS 用の URL と、ブラウザに保存した設定は引き継がれません（アドレスごとに別物）。独自ドメインに移るときは、利用者に URL の貼り直しを案内します。
- モデルを学習し直したら、`models/armnet.onnx` を `site/models/` にコピーし直します。

## OBS に載せる

OBS のブラウザソースは、標準ではカメラを使えません。方法は 2 つあります。操作画面の「OBS に載せる」にも同じ手順があります。

1. **ブラウザの窓を OBS で映す（かんたん）**：`overlay.html` をふつうのブラウザで別の窓に開き、OBS の「ウィンドウキャプチャ」でその窓を選ぶ。窓は最小化しない。
2. **OBS のブラウザソースに直接入れる**：OBS のショートカットのリンク先の最後に `--enable-media-stream --use-fake-ui-for-media-stream` を足して起動し、ブラウザソースに OBS 用の URL を貼る。
   - OBS 32.0.1（ブラウザは Chromium 127）と ELECOM 8MP Webcam で、映像が毎秒約 30 回更新されて映ることを確認しました（2026-11-15）。
   - 操作画面（ブラウザ）と OBS のブラウザソースで同じカメラを同時に使っても、この環境（Windows 11）では取り合いになりませんでした。開けなかった場合は、3 秒ごとに自動で試し直します。
   - 表示は、ブラウザソースの幅と高さの両方に収まる大きさになります（余りは透明）。

設定（可動域、映す範囲、ゲージの有無、カメラの名前）は、OBS 用の URL の `#` 以降に入ります。OBS のブラウザソースは別のブラウザ扱いで、操作画面で保存した設定が見えないためです。**設定を変えたら、URL をコピーし直してください。** 方法 1 で同じブラウザを使っている場合は、操作画面で変えた設定がすぐ反映されます。

映す範囲は OBS ではなく操作画面で決めます。OBS 側で切り抜くと、端の赤い縁やゲージまで切れるためです。

## カメラの開き方

「1280×720、できれば 60fps」→「1280×720」→「おまかせ」の順に頼み、開けたものを使います。
ELECOM 8MP Webcam は、OBS のブラウザソース（Chromium）から「できれば 60fps」と頼むと、受け付けたあと映像を出せずに失敗します（エラーは使用中と同じ `NotReadableError`）。Firefox では同じ頼み方で開けたので、ブラウザによって挙動が違います。Python 版で見つけた「対応していないモードを頼むと映らなくなる」と同じ性質です。

## 調べ方（OBS のブラウザソースの中）

OBS を `--remote-debugging-port=9222` つきで起動すると、`http://127.0.0.1:9222/` からブラウザソースの中のページを開発者ツールで見られます（エラーや画面の確認用）。

## Python 版との一致（2026-11-15 に確認）

同じ録画のコマ 400 枚（連続）を、ブラウザ版と Python 版の両方に通して比べました。

| 項目 | 結果 |
| --- | --- |
| 手の検出 | どちらも 400 / 400 |
| 手首の位置の差 | 中央 1.8px、95% が 3.7px 以内 |
| 手首の角度の差 | 中央 1.1°、95% が 4.3° 以内、相関 0.99 |
| 1 コマの時間（RTX 3070 Ti、GPU） | 中央 14ms |

差の主な原因は、手首まわりの画像を縮めるときの補間の違いです（ブラウザ版は 4 倍で描いてから平均、Python 版は OpenCV の面積平均）。

`handlab.js` の数値（切り出しの大きさ、しきい値、色）は、`aimhand/analyze/armnet.py`・`forearm.py`・`preview/draw.py` と合わせてあります。片方を変えたら、もう片方も直してください。

## まだ無いもの・分かっていないこと

- 実際のカメラでの確認（ここまでは、録画のコマを流して確かめました）
- OBS のウィンドウキャプチャでの確認（ブラウザソースは確認済み）
- OBS の中で、手が映っている状態での骨格とテンションの表示（確認したのは映像とゲージが出る所まで）
- 他の人の環境（別のパッド、照明、カメラ、GPU の無い PC）での精度と速さ
- 左手（角度の正負の説明は右手前提）
- 中国語（繁体字）の画面（いまは日本語・英語・中国語（簡体字）・韓国語。英・中・韓の文言は母語話者の確認をまだ受けていない）
- 「パッドとの色の差」で前腕を探す方式（ブラウザ版は学習済みモデルだけ）
