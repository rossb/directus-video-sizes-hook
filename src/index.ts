import { defineHook } from '@directus/extensions-sdk';
import { spawn } from 'child_process';
import path from 'path';
import fetch from 'node-fetch';

interface VideoDimensions {
	width: number;
	height: number;
}

function addProcessingFailedTag(existingTags: string | null): string {
	if (!existingTags) {
		return '["processing-failed"]';
	}
	
	// Handle JSON array format
	if (existingTags.startsWith('[') && existingTags.endsWith(']')) {
		try {
			const tagArray = JSON.parse(existingTags);
			if (!tagArray.includes('processing-failed')) {
				tagArray.push('processing-failed');
			}
			return JSON.stringify(tagArray);
		} catch {
			// Fallback if JSON parsing fails
			return '["processing-failed"]';
		}
	}
	
	// Handle comma-separated format
	const tags = existingTags.split(',').map(tag => tag.trim()).filter(tag => tag);
	if (!tags.includes('processing-failed')) {
		tags.push('processing-failed');
	}
	return JSON.stringify(tags);
}

function getVideoDimensions(filePath: string): Promise<VideoDimensions | null> {
	return new Promise((resolve, reject) => {
		const ffprobe = spawn('ffprobe', [
			'-v', 'quiet',
			'-print_format', 'json',
			'-show_entries', 'stream=width,height,display_aspect_ratio,sample_aspect_ratio',
			'-select_streams', 'v:0',
			filePath
		]);

		let output = '';
		let errorOutput = '';

		ffprobe.stdout.on('data', (data) => {
			output += data.toString();
		});

		ffprobe.stderr.on('data', (data) => {
			errorOutput += data.toString();
		});

		ffprobe.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`ffprobe failed with code ${code}: ${errorOutput}`));
				return;
			}

			try {
				const metadata = JSON.parse(output);
				const videoStream = metadata.streams?.[0];
				
				if (videoStream && videoStream.width && videoStream.height) {
					let displayWidth = videoStream.width;
					let displayHeight = videoStream.height;
					
					// Calculate display dimensions if sample aspect ratio exists
					if (videoStream.sample_aspect_ratio && videoStream.sample_aspect_ratio !== 'N/A' && videoStream.sample_aspect_ratio !== '1:1') {
						const [sarNum, sarDen] = videoStream.sample_aspect_ratio.split(':').map(Number);
						if (sarNum && sarDen && sarNum !== sarDen) {
							// Apply sample aspect ratio to get display dimensions
							displayWidth = Math.round(videoStream.width * sarNum / sarDen);
						}
					}
					
					resolve({
						width: displayWidth,
						height: displayHeight
					});
				} else {
					resolve(null);
				}
			} catch (error) {
				reject(error);
			}
		});

		ffprobe.on('error', (error) => {
			reject(error);
		});
	});
}

async function getCloudinaryVideoDimensions(filename: string): Promise<VideoDimensions | null> {
	try {
		const cloudName = process.env.STORAGE_CLOUDINARY_CLOUD_NAME;
		const apiKey = process.env.STORAGE_CLOUDINARY_API_KEY;
		const apiSecret = process.env.STORAGE_CLOUDINARY_API_SECRET;
		
		if (!cloudName || !apiKey || !apiSecret) {
			console.error('Missing Cloudinary credentials');
			return null;
		}
		
		// Remove file extension for Cloudinary public ID
		const publicId = filename.replace(/\.[^/.]+$/, '');
		
		// Create basic auth for Cloudinary Admin API
		const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
		
		const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload/${publicId}`, {
			method: 'GET',
			headers: {
				'Authorization': `Basic ${auth}`
			}
		});
		
		if (!response.ok) {
			console.error('Cloudinary API error:', response.status, response.statusText);
			return null;
		}
		
		const data = await response.json() as VideoDimensions;
		
		if (data.width && data.height) {
			return {
				width: data.width,
				height: data.height
			};
		}
		
		return null;
	} catch (error) {
		console.error('Error fetching Cloudinary video dimensions:', error);
		return null;
	}
}

export default defineHook(({ schedule }, { services, getSchema, database }) => {
	schedule('*/10 * * * * *', async () => { // Every 10 seconds
		try {
			// Reset videos with 0 dimensions to null for reprocessing
			await database('directus_files')
				.where('type', 'like', 'video/%')
				.where(function() {
					this.where('width', 0).orWhere('height', 0);
				})
				.update({
					width: null,
					height: null
				});

			// Find video files without dimensions OR with reprocess tags, but skip failed ones
			const videosNeedingProcessing = await database('directus_files')
				.where('type', 'like', 'video/%')
				.where('tags', 'not like', '%processing-failed%') // Skip failed videos
				.where(function() {
					this.where(function() {
						// Normal processing: local storage only, without dimensions
						this.where('storage', 'local')
							.whereNull('width')
							.whereNull('height');
					}).orWhere(function() {
						// Manual dimensions: any storage type with reprocess:WIDTHxHEIGHT tag
						this.where('tags', 'like', '%reprocess:%x%');
					}).orWhere(function() {
						// Reprocess: any local storage file with "reprocess" tag
						this.where('storage', 'local')
							.where('tags', 'like', '%reprocess%')
							.where('tags', 'not like', '%reprocess:%x%');
					});
				})
				.limit(5); // Process max 5 at a time
			
			if (videosNeedingProcessing.length === 0) {
				return; // No videos to process
			}
			
			console.log(`Found ${videosNeedingProcessing.length} videos needing dimension processing`);
			
			for (const file of videosNeedingProcessing) {
				try {
					console.log('Processing video:', file.filename_disk, 'Storage:', file.storage, 'Tags:', file.tags);
					
					let dimensions: VideoDimensions | null = null;
					let shouldRemoveReprocessTag = false;
					
					// Check for manual dimension override in tags
					const tags = file.tags || '';
					const manualDimensionsMatch = tags.match(/reprocess:(\d+)x(\d+)/i);
					
					if (manualDimensionsMatch) {
						// Manual dimensions specified in tag
						const width = parseInt(manualDimensionsMatch[1]);
						const height = parseInt(manualDimensionsMatch[2]);
						
						if (width > 0 && height > 0) {
							dimensions = { width, height };
							console.log('Using manual dimensions from tag:', dimensions);
							shouldRemoveReprocessTag = true;
						}
					} else if (tags.includes('reprocess')) {
						// Simple reprocess tag - analyze file
						shouldRemoveReprocessTag = true;
						
						if (file.storage === 'cloudinary') {
							dimensions = await getCloudinaryVideoDimensions(file.filename_disk);
						} else {
							const filePath = path.join('/directus/uploads', file.filename_disk);
							dimensions = await getVideoDimensions(filePath);
						}
					} else {
						// No reprocess tag - normal processing for files without dimensions
						if (file.storage === 'cloudinary') {
							dimensions = await getCloudinaryVideoDimensions(file.filename_disk);
						} else {
							const filePath = path.join('/directus/uploads', file.filename_disk);
							dimensions = await getVideoDimensions(filePath);
						}
					}
					
					if (dimensions) {
						console.log('Dimensions found for', file.filename_disk, ':', dimensions);
						
						// Prepare update object
						const updateData: any = {
							width: dimensions.width,
							height: dimensions.height
						};
						
						// Remove reprocess tag if it exists
						if (shouldRemoveReprocessTag) {
							let updatedTags = tags
								.replace(/reprocess:\d+x\d+/gi, '')
								.replace(/reprocess/gi, '')
								.replace(/,,+/g, ',')
								.replace(/^,|,$/g, '')
								.trim();
							
							// Handle array format tags and ensure proper cleanup
							if (updatedTags.startsWith('["') && updatedTags.endsWith('"]')) {
								try {
									const tagArray = JSON.parse(updatedTags);
									const cleanedArray = tagArray.filter((tag: string) => tag && tag.trim() !== '');
									updatedTags = cleanedArray.length > 0 ? JSON.stringify(cleanedArray) : null;
								} catch {
									updatedTags = updatedTags === '[""]' ? null : updatedTags;
								}
							} else if (updatedTags === '' || updatedTags === '[""]') {
								updatedTags = null;
							}
							
							updateData.tags = updatedTags;
							console.log('Removing reprocess tag. New tags:', updatedTags);
						}
						
						await database('directus_files')
							.where('id', file.id)
							.update(updateData);
							
						console.log('Updated dimensions for:', file.filename_disk);
					} else {
						console.log('No dimensions found for:', file.filename_disk);
						
						// If this was a reprocess request, still remove the tag to avoid infinite loops
						if (shouldRemoveReprocessTag) {
							let updatedTags = tags
								.replace(/reprocess:\d+x\d+/gi, '')
								.replace(/reprocess/gi, '')
								.replace(/,,+/g, ',')
								.replace(/^,|,$/g, '')
								.trim();
							
							// Handle array format tags and ensure proper cleanup
							if (updatedTags.startsWith('["') && updatedTags.endsWith('"]')) {
								try {
									const tagArray = JSON.parse(updatedTags);
									const cleanedArray = tagArray.filter((tag: string) => tag && tag.trim() !== '');
									updatedTags = cleanedArray.length > 0 ? JSON.stringify(cleanedArray) : null;
								} catch {
									updatedTags = updatedTags === '[""]' ? null : updatedTags;
								}
							} else if (updatedTags === '' || updatedTags === '[""]') {
								updatedTags = null;
							}
							
							await database('directus_files')
								.where('id', file.id)
								.update({
									tags: addProcessingFailedTag(updatedTags)
								});
						} else {
							// Mark as failed by adding processing-failed tag
							await database('directus_files')
								.where('id', file.id)
								.update({
									tags: addProcessingFailedTag(file.tags)
								});
						}
					}
				} catch (error) {
					console.error('Error processing video:', file.filename_disk, error);
					
					// Mark as failed to avoid infinite retries
					await database('directus_files')
						.where('id', file.id)
						.update({
							tags: addProcessingFailedTag(file.tags)
						});
				}
			}
		} catch (error) {
			console.error('Error in video metadata processing job:', error);
		}
	});
});
