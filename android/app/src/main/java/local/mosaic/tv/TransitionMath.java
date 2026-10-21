package local.mosaic.tv;
public final class TransitionMath {
 private TransitionMath(){}
 public static float opacity(String type,long durationMs,double epoch,double now,boolean ready){if(!ready)return 1;if(!"fade".equals(type)||durationMs<100||durationMs>2000)return 0;return (float)Math.max(0,Math.min(1,1-(now-epoch)/durationMs));}
}
