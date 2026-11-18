package expo.modules.webviewcookies

import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadFilenameTest {
  @Test fun sanitizesNativeDownloadAndMediaStoreNames() {
    assertEquals("手機_驗收_.csv", downloadFilename("手機/驗收?.csv"))
    assertEquals("a_b_c_d_e_f_g_h_i_j_k", downloadFilename("a\\b/c:d*e?f\"g<h>i|j\u0000k"))
    assertEquals("download", downloadFilename(".."))
    assertEquals("download", downloadFilename(""))
    assertEquals("測試.csv", downloadFilename("測試.csv"))
    assertEquals(120, downloadFilename("a".repeat(150)).length)
  }
}
