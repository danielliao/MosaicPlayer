package local.mosaic.tv;
import java.util.Map;
/** Deliberately small grammar: no fuzzy matching and no implicit target. */
public final class ControllerCommand {
 public final String action,mediaId;
 private ControllerCommand(String action,String mediaId){this.action=action;this.mediaId=mediaId;}
 public static ControllerCommand parse(String text,Map<String,String> media){
  String value=text.trim();
  if(value.equals("暂停")||value.equalsIgnoreCase("pause"))return new ControllerCommand("pause",null);
  if(value.equals("继续")||value.equals("恢复")||value.equalsIgnoreCase("resume"))return new ControllerCommand("resume",null);
  String name=value.startsWith("播放")?value.substring(2).trim():value.regionMatches(true,0,"play ",0,5)?value.substring(5).trim():null;
  if(name==null||name.isEmpty())return null;
  String id=null;
  for(Map.Entry<String,String> entry:media.entrySet())if(name.equals(entry.getValue())){if(id!=null)return null;id=entry.getKey();}
  return id==null?null:new ControllerCommand("play",id);
 }
 public static boolean canConfirm(String group,ControllerCommand command){return group!=null&&!group.isEmpty()&&command!=null;}
}
