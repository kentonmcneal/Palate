Pod::Spec.new do |s|
  s.name           = 'PalateVisitMonitor'
  s.version        = '1.0.0'
  s.summary        = 'CLVisit-based passive dining capture for Palate'
  s.description    = 'Native iOS visit monitoring (CLVisit + significant-change) bridged to JS via Expo Modules.'
  s.author         = 'Palate'
  s.homepage       = 'https://palate.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
