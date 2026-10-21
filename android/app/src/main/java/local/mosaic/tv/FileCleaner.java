package local.mosaic.tv;

import java.io.File;

final class FileCleaner {
  private FileCleaner() {}

  static void clear(File directory) {
    File[] files = directory.listFiles();
    if (files != null)
      for (File file : files) {
        if (file.isDirectory()) clear(file);
        file.delete();
      }
  }
}
