#!/bin/env groovy​

folder("triggers")

job("triggers/tectonic-installer-nightly-trigger") {
  logRotator(10, 1000)
  description('Tectonic Installer nightly builds against master. Changes here will be reverted automatically.')

  wrappers {
    colorizeOutput()
    timestamps()
  }

  triggers {
    cron('H 3 * * *')
  }

  steps {
    triggerBuilder {
      configs {
        blockableBuildTriggerConfig {
          projects("tectonic-installer/master")
          block {
            buildStepFailureThreshold("FAILURE")
            unstableThreshold("UNSTABLE")
            failureThreshold("FAILURE")
          }
          configs {
            booleanParameters {
              configs {
                booleanParameterConfig {
                  name('PLATFORM/GCP')
                  value(false)
                }
                booleanParameterConfig {
                  name('NOTIFY_SLACK')
                  value(true)
                }
              }
            }
          }
        }
      }
    }
  }

  publishers {
    wsCleanup()
  }
}
