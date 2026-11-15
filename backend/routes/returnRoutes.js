const express = require('express');
const {
  createReturnRequest,
  getMyReturnRequests,
  getReturnRequests,
  updateReturnRequest,
  getReturnPhoto,
} = require('../controllers/returnController');
const { protect, admin } = require('../middleware/auth');
const { uploadReturnPhotos } = require('../middleware/returnPhotoUpload');

const router = express.Router();

router.post('/', protect, uploadReturnPhotos, createReturnRequest);
router.get('/mine', protect, getMyReturnRequests);
router.get('/:id/photos/:photoId', protect, getReturnPhoto);
router.get('/', protect, admin, getReturnRequests);
router.patch('/:id', protect, admin, updateReturnRequest);

module.exports = router;
