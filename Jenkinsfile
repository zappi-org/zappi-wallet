pipeline {
    agent any

    environment {
        IMAGE_NAME = 'zappi-wallet'
        IMAGE_TAG  = "build-${env.BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build') {
            steps {
                sh "docker build -t ${IMAGE_NAME}:${IMAGE_TAG} ."
            }
        }

        stage('Tag') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'alpha') {
                        sh "docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest"
                    } else if (env.BRANCH_NAME == 'staging') {
                        sh "docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:staging"
                    } else if (env.BRANCH_NAME == 'nightly') {
                        sh "docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:nightly"
                    }
                }
            }
        }

        stage('Deploy') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'alpha') {
                        sh """
                            docker compose -p zappi-wallet down || true
                            docker compose -p zappi-wallet up -d
                        """
                    } else if (env.BRANCH_NAME == 'staging') {
                        sh """
                            docker compose -f docker-compose.staging.yml -p zappi-wallet-staging down || true
                            docker compose -f docker-compose.staging.yml -p zappi-wallet-staging up -d
                        """
                    } else if (env.BRANCH_NAME == 'nightly') {
                        sh """
                            docker compose -f docker-compose.nightly.yml -p zappi-wallet-nightly down || true
                            docker compose -f docker-compose.nightly.yml -p zappi-wallet-nightly up -d
                        """
                    }
                }
            }
        }
    }

    post {
        failure {
            echo "Build failed: ${env.JOB_NAME} #${env.BUILD_NUMBER} (${env.BRANCH_NAME})"
        }
        success {
            echo "Build succeeded: ${env.JOB_NAME} #${env.BUILD_NUMBER} (${env.BRANCH_NAME})"
        }
        always {
            cleanWs()
        }
    }
}
