pipeline {
    agent any

    environment {
        IMAGE_NAME = 'zappi-wallet'
    }

    stages {
        stage('Build') {
            steps {
                checkout scm
                script {
                    if (env.TAG_NAME == null) {
                        error "This pipeline only deploys version tags: ${env.BRANCH_NAME}"
                    }
                }
                sh """
                    docker build \
                        --build-arg VITE_ZAPPI_CHANNEL=main \
                        -t ${IMAGE_NAME}:${BUILD_NUMBER} .
                """
            }
        }

        stage('Approve Production') {
            steps {
                input message: "Deploy ${TAG_NAME} to production?"
            }
        }

        stage('Deploy Production') {
            steps {
                sh """
                    docker tag ${IMAGE_NAME}:${BUILD_NUMBER} ${IMAGE_NAME}:${TAG_NAME}
                    docker tag ${IMAGE_NAME}:${BUILD_NUMBER} ${IMAGE_NAME}:latest
                    docker compose -p zappi-wallet down || true
                    docker compose -p zappi-wallet up -d
                """
            }
        }
    }

    post {
        success {
            echo "SUCCESS: ${currentBuild.displayName} (main)"
        }
        failure {
            echo "FAILED: ${currentBuild.displayName}"
        }
        always {
            cleanWs()
        }
    }
}
