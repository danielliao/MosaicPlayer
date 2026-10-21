package local.mosaic.tv;

import android.content.Context;
import android.graphics.*;
import android.view.*;
import android.widget.*;
import androidx.media3.exoplayer.ExoPlayer;
import org.json.JSONObject;

final class WallView extends FrameLayout {
  private final FrameLayout viewport;
  private final TextureView video;
  private final ImageView image;
  private String geometryKey;
  private JSONObject layout, screen;
  private double sourceW = 1920, sourceH = 1080;
  private Bitmap bitmap;
  private ExoPlayer player;

  WallView(Context c) {
    super(c);
    setBackgroundColor(Color.BLACK);
    setClipChildren(true);
    viewport = new FrameLayout(c);
    viewport.setClipChildren(true);
    addView(viewport, new LayoutParams(1, 1));
    video = new TextureView(c);
    video.setOpaque(true);
    viewport.addView(video, new LayoutParams(-1, -1));
    image = new ImageView(c);
    image.setScaleType(ImageView.ScaleType.MATRIX);
    viewport.addView(image, new LayoutParams(-1, -1));
    image.setVisibility(GONE);
  }

  void configure(JSONObject layout, JSONObject screen, double width, double height) {
    String key = layout.toString() + screen.toString() + width + ":" + height;
    if (key.equals(geometryKey)) return;
    geometryKey = key;
    this.layout = layout;
    this.screen = screen;
    sourceW = Math.max(1, width);
    sourceH = Math.max(1, height);
    applyCrop();
  }

  void showVideo(ExoPlayer p) {
    if (player != null && player != p) player.clearVideoTextureView(video);
    player = p;
    image.setVisibility(GONE);
    image.setImageDrawable(null);
    bitmap = null;
    video.setVisibility(VISIBLE);
    p.setVideoTextureView(video);
    applyCrop();
  }

  void showImage(Bitmap b) {
    if (player != null) player.clearVideoTextureView(video);
    player = null;
    bitmap = b;
    image.setImageBitmap(b);
    image.setVisibility(VISIBLE);
    video.setVisibility(INVISIBLE);
    applyCrop();
  }

  void clear() {
    if (player != null) player.clearVideoTextureView(video);
    player = null;
    bitmap = null;
    image.setImageDrawable(null);
    image.setVisibility(GONE);
    video.setVisibility(INVISIBLE);
  }

  /** Captures only this app's actual cropped content; TextureView pixels are not in View.draw. */
  Bitmap capture() throws java.io.IOException {
    if (getWidth() <= 0
        || getHeight() <= 0
        || viewport.getWidth() <= 1
        || viewport.getHeight() <= 1
        || bitmap == null && player == null) throw new java.io.IOException("当前没有可采集画面");
    float scale = Math.min(1f, 960f / Math.max(getWidth(), getHeight()));
    Bitmap result =
        Bitmap.createBitmap(
            Math.max(1, Math.round(getWidth() * scale)),
            Math.max(1, Math.round(getHeight() * scale)),
            Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(result);
    canvas.drawColor(Color.BLACK);
    canvas.scale(scale, scale);
    canvas.save();
    canvas.translate(viewport.getLeft(), viewport.getTop());
    canvas.clipRect(0, 0, viewport.getWidth(), viewport.getHeight());
    if (image.getVisibility() == VISIBLE) image.draw(canvas);
    else {
      if (!video.isAvailable()) {
        result.recycle();
        throw new java.io.IOException("视频纹理尚未就绪");
      }
      Bitmap frame =
          video.getBitmap(
              Math.max(1, Math.round(video.getWidth() * scale)),
              Math.max(1, Math.round(video.getHeight() * scale)));
      if (frame == null) {
        result.recycle();
        throw new java.io.IOException("无法读取视频纹理");
      }
      canvas.drawBitmap(frame, null, new Rect(0, 0, video.getWidth(), video.getHeight()), null);
      frame.recycle();
    }
    canvas.restore();
    return result;
  }

  @Override
  protected void onSizeChanged(int w, int h, int oldw, int oldh) {
    super.onSizeChanged(w, h, oldw, oldh);
    applyCrop();
  }

  private void applyCrop() {
    if (layout == null || getWidth() == 0 || getHeight() == 0) return;
    SyncMath.Crop c =
        SyncMath.crop(
            layout.optInt("cols", 1),
            layout.optInt("rows", 1),
            layout.optDouble("tileWidth", 1920),
            layout.optDouble("tileHeight", 1080),
            layout.optDouble("gapX", 0),
            layout.optDouble("gapY", 0),
            screen.optInt("col"),
            screen.optInt("row"),
            getWidth(),
            getHeight(),
            sourceW,
            sourceH);
    LayoutParams params =
        new LayoutParams((int) Math.round(c.viewportWidth), (int) Math.round(c.viewportHeight));
    params.leftMargin = (int) Math.round(c.viewportX);
    params.topMargin = (int) Math.round(c.viewportY);
    viewport.setLayoutParams(params);
    Matrix matrix = new Matrix();
    matrix.setScale(
        (float) (c.contentWidth / params.width), (float) (c.contentHeight / params.height));
    matrix.postTranslate((float) c.contentX, (float) c.contentY);
    video.setTransform(matrix);
    if (bitmap != null) {
      Matrix photo = new Matrix();
      photo.setScale(
          (float) (c.contentWidth / bitmap.getWidth()),
          (float) (c.contentHeight / bitmap.getHeight()));
      photo.postTranslate((float) c.contentX, (float) c.contentY);
      image.setImageMatrix(photo);
    }
  }
}
