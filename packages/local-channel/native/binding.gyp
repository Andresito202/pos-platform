{
  "targets": [
    {
      "target_name": "camacho_windows_pipe",
      "sources": [
        "windows-pipe.cc"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "advapi32.lib"
            ],
            "defines": [
              "_WIN32_WINNT=0x0602",
              "UNICODE",
              "_UNICODE",
              "BUILDING_UV_SHARED=1"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [
                  "/std:c++17"
                ]
              }
            }
          }
        ]
      ],
      "defines!": [
        "_HAS_EXCEPTIONS=0"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ]
    }
  ]
}
