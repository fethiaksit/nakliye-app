require 'fileutils'
require 'xcodeproj'

output_dir = File.expand_path(ARGV.fetch(0))
source_path = File.expand_path(ARGV.fetch(1))
bundle_identifier = ARGV.fetch(2)
role = ARGV.fetch(3)
phone = ARGV.fetch(4)
password = ARGV.fetch(5)
other_party = ARGV.fetch(6)
project_path = File.join(output_dir, 'NakliyeGoFunctionalUITests.xcodeproj')
FileUtils.mkdir_p(output_dir)

configuration_path = File.join(output_dir, 'GeneratedTestConfiguration.swift')
File.write(configuration_path, <<~SWIFT)
  enum TestConfiguration {
      static let bundleIdentifier = #{bundle_identifier.inspect}
      static let role = #{role.inspect}
      static let phone = #{phone.inspect}
      static let password = #{password.inspect}
      static let otherParty = #{other_party.inspect}
  }
SWIFT

project = Xcodeproj::Project.new(project_path)
target = project.new_target(:ui_test_bundle, 'NakliyeGoFunctionalUITests', :ios, '17.0')
source_group = project.main_group.new_group('Tests')
target.add_file_references([source_group.new_file(source_path), source_group.new_file(configuration_path)])
target.build_configurations.each do |configuration|
  configuration.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  configuration.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  configuration.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.nakliyego.functional-ui-tests'
  configuration.build_settings['SWIFT_VERSION'] = '5.0'
  configuration.build_settings['TARGETED_DEVICE_FAMILY'] = '1'
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project_path, 'NakliyeGoFunctionalUITests', true)
